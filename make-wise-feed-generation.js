// scripts/generate-feed.js
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mysql = require('mysql2/promise');
const fs = require('fs');
const zlib = require('zlib');
const { once } = require('events');
const path = require('path');

const PAGE_SIZE = 5000;                         // tune as needed
const CURRENCY = 'USD';                         // change if needed

const makeNames = [
  'Acura', 'Audi', 'BMW', 'Buick', 'Cadillac', 'Chevy', 'Chrysler', 'Dodge',
  'Ford', 'GMC', 'Honda', 'Hyundai', 'Infiniti', 'Isuzu', 'Jaguar', 'Jeep',
  'Kia', 'LandRover', 'Lexus', 'Lincoln', 'Mazda', 'Mercedes', 'Nissan',
  'Pontiac', 'Porsche', 'Saturn', 'Subaru', 'Suzuki', 'Toyota', 'Volkswagen', 'Volvo'
];

// ---------- Helpers ----------
function escapeXml(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function parseMileString(val) {
  if (!val) return undefined;
  let s = String(val).trim().toLowerCase().replace(/[, ]+/g, '');
  const m = s.match(/^(\d+(\.\d+)?)(k|m)?$/i);
  if (m) {
    const num = parseFloat(m[1]);
    const suffix = (m[3] || '').toLowerCase();
    if (suffix === 'k') return String(Math.round(num * 1000));
    if (suffix === 'm') return String(Math.round(num * 1000000));
    return String(Math.round(num));
  }
  const digits = s.match(/\d+/g);
  if (digits && digits.length) return digits.join('');
  return undefined;
}

function parseSku(sku) {
  const tokens = (sku || '').split('-');
  const yearIdx = tokens.findIndex((t) => /^\d{4}$/.test(t));
  const make = tokens[0] || '';
  let model = '', year = '', part = '', spec = '', mileFromSku;

  if (yearIdx >= 1) {
    year = tokens[yearIdx] || '';
    model = tokens.slice(1, yearIdx).join('-') || tokens[1] || '';
    part = tokens[yearIdx + 1] || tokens[3] || '';
    const tail = tokens.slice(yearIdx + 2);
    if (tail.length) {
      const last = tail[tail.length - 1];
      if (/\d/.test(last) || /k$/i.test(last) || /m$/i.test(last)) {
        mileFromSku = parseMileString(last);
        spec = tail.slice(0, tail.length - 1).join('-');
      } else {
        spec = tail.join('-');
      }
    }
  } else {
    model = tokens[1] || '';
    year = tokens[2] || '';
    part = tokens[3] || '';
    const tail = tokens.slice(4);
    if (tail.length) {
      const last = tail[tail.length - 1];
      if (/\d/.test(last) || /k$/i.test(last) || /m$/i.test(last)) {
        mileFromSku = parseMileString(last);
        spec = tail.slice(0, tail.length - 1).join('-');
      } else {
        spec = tail.join('-');
      }
    }
  }

  spec = spec ? spec.trim().replace(/^,|,$/g, '').replace(/^\(|\)$/g, '') : '';
  return { make, model, year, part, spec, mileFromSku };
}

function defaultImageForPart(part) {
  const p = (part || '').toLowerCase();
  if (p.includes('engine')) return 'https://s3.us-east-1.amazonaws.com/partscentral.us/public/engine-1.png';
  if (p.includes('transmission') || p.includes('trans')) return 'https://s3.us-east-1.amazonaws.com/partscentral.us/Trasmission_.png';
  return 'https://s3.us-east-1.amazonaws.com/partscentral.us/public/engine-1.png';
}

// safe write with backpressure awareness
async function writeAsync(stream, chunk) {
  if (!stream.write(chunk)) {
    await once(stream, 'drain');
  }
}

async function generateMakeFeed(pool, make) {
  const OUT_PATH = `./public/${make}-feed-file.xml`;
  const OUT_GZIP_PATH = `./public/${make}-feed-file.xml.gz`;
  const outDir = path.dirname(OUT_PATH);
  fs.mkdirSync(outDir, { recursive: true });

  const stream = fs.createWriteStream(OUT_PATH, { encoding: 'utf8' });

  try {
    // Write XML header with proper formatting
    const header = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">
  <channel>
    <title>PartsCentral ${make} Product Feed</title>
    <link>https://partscentral.us/</link>
    <description>Dynamic product feed for ${make}</description>
`;

    await writeAsync(stream, header);

    let lastId = 0;
    let total = 0;
    while (true) {
      // fetch next page by id, filtered by make via SKU prefix
      const [rows] = await pool.query(
        `SELECT id, sku, title, description, product_img, inStock, actualprice, discountedPrice, miles
         FROM productvariant_1
         WHERE id > ? AND sku LIKE ?
         ORDER BY id ASC
         LIMIT ?`,
        [lastId, `${make}-%`, PAGE_SIZE]
      );

      const items = Array.isArray(rows) ? rows : [];
      if (!items.length) break;

      for (const r of items) {
        // parse sku and prepare fields
        const sku = r.sku || '';
        const { model, year, part, spec, mileFromSku } = parseSku(sku);
        const mile = mileFromSku || parseMileString(r.miles) || '';
        const id = r.id ? String(r.id) : sku;
        const title = r.title || `${year} ${make} ${model} Used ${part}`.trim();
        const description = r.description ||
          `This ${make} ${model} ${part} is from ${year} models. Each ${part} is tested and ready to install and offers improved performance.\n\nThis Unit is perfect for anyone in the market for reliable used ${part} that will offer superior results - a great addition to any repair project!`;
        const image_link = r.product_img || defaultImageForPart(part);
        const availability = Number(r.inStock) === 1 ? 'Yes' : 'No';
        const price = (typeof r.actualprice === 'number') ? `${Number(r.actualprice).toFixed(2)} ${CURRENCY}` : '';
        const final_price = (typeof r.discountedPrice === 'number') ? `${Number(r.discountedPrice).toFixed(2)}` : price;

        // Format product as XML item with proper indentation
        const itemXml = `    <item>
      <g:id>${escapeXml(id)}</g:id>
      <title>${escapeXml(title)}</title>
      <link>${escapeXml(`https://partscentral.us/catalogue/${encodeURIComponent((part || '').toLowerCase())}/home?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&year=${encodeURIComponent(year)}&part=${encodeURIComponent(part)}`)}</link>
      <description>${escapeXml(description)}</description>
      <g:image_link>${escapeXml(image_link)}</g:image_link>
      <g:availability>${escapeXml(availability)}</g:availability>
      <g:price>${escapeXml(price)}</g:price>
      <g:final_price>${escapeXml(final_price)}</g:final_price>
      <g:condition>${escapeXml('used')}</g:condition>
      <g:brand>${escapeXml(make)}</g:brand>
      <g:model>${escapeXml(model)}</g:model>
      <g:year>${escapeXml(year)}</g:year>
      <g:part>${escapeXml(part)}</g:part>
      <g:mile>${escapeXml(mile)}</g:mile>
      <g:option>${escapeXml(spec)}</g:option>
    </item>
`;

        await writeAsync(stream, itemXml + '\n');  // Extra \n for blank line between items
        lastId = r.id;
        total += 1;
      }

      console.log(`Wrote ${total} rows for ${make}, lastId=${lastId}`);
    }

    // Write XML footer with proper formatting
    const footer = `  </channel>
</rss>
`;

    await writeAsync(stream, footer);

    // Close the stream
    stream.end();

    // wait for finish
    await once(stream, 'finish');
    const stats = fs.statSync(OUT_PATH);
    console.log(`Feed written to ${OUT_PATH} (${total} items, ${Math.round(stats.size / 1024 / 1024)} MB)`);

    // Optionally: create gzipped copy
    await createGzip(OUT_PATH, OUT_GZIP_PATH);
    console.log(`Gzipped feed written to ${OUT_GZIP_PATH}`);
  } finally {
    // Stream auto-closes
  }
}

async function createGzip(srcPath, dstPath) {
  return new Promise((resolve, reject) => {
    const inp = fs.createReadStream(srcPath);
    const out = fs.createWriteStream(dstPath);
    const gzip = zlib.createGzip({ level: zlib.constants.Z_BEST_COMPRESSION });
    inp.pipe(gzip).pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
    inp.on('error', reject);
  });
}

// ---------- Main ----------
async function generateFeeds() {
  // read DB envs from process.env
  const {
    MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE
  } = process.env;

  if (!MYSQL_HOST || !MYSQL_USER || !MYSQL_DATABASE) {
    throw new Error('Missing MySQL env vars (MYSQL_HOST, MYSQL_USER, MYSQL_DATABASE)');
  }

  const pool = mysql.createPool({
    host: MYSQL_HOST,
    port: MYSQL_PORT ? Number(MYSQL_PORT) : 3306,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD || '',
    database: MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 5
  });

  try {
    for (const make of makeNames) {
      console.log(`Generating feed for ${make}...`);
      await generateMakeFeed(pool, make);
    }
  } finally {
    try { await pool.end(); } catch (_) {}
  }

  console.log('All feeds generated.');
}

// Run
generateFeeds()
  .then(() => console.log('Done.'))
  .catch((err) => {
    console.error('Feed generation failed:', err);
    process.exitCode = 1;
  });