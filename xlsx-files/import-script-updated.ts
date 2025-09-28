import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import * as XLSX from 'xlsx';
import { readdirSync } from 'fs';
import { join, extname } from 'path';

const prisma = new PrismaClient();

// 1️⃣ HEADER-TO-COLUMN mapping
const headerMap: Record<string, string> = {
  make:             'Make Name' , // also "9" ,   
  model:            'Model Name',
  year:             'Model Year',
  partType:         'Part Name',
  subPart:          'Sub Part Name', // sub Part Name
  inStock:          'Stock',
  miles:            'Miles',
  actualPrice:      'Actual Price 1',
  discountedPrice:  'Discount Price 1',
  miles2:           'Miles_1',
  actualPrice2:     'Actual Price 2',
  discountedPrice2: 'Discount Price 2',
  // sku is generated, so no mapping needed
};




function cleanMiles(miles: any): string | null {
  if (miles == null) return null;
  let s = String(miles).trim();

  // normalize unicode, remove NBSP, fullwidth digits/K, etc.
  s = s.replace(/\u00A0/g, ' ').normalize('NFKC');

  // uppercase to make 'k' handling consistent
  s = s.toUpperCase();

  // If it contains a "K" (40K, 40 K, 40.5K, 40,5K, fullwidth K etc.)
  const kMatch = s.match(/([0-9]+(?:[.,][0-9]+)?)\s*[KＫ]/i);
  if (kMatch) {
    // replace comma decimal with dot, then parse
    const numPart = kMatch[1].replace(',', '.');
    const num = parseFloat(numPart) * 1000;
    if (Number.isNaN(num)) return null;
    return String(Math.round(num));
  }

  // If it looks like a normal number with commas/periods as thousands separators
  // remove all non-digit characters and parse
  const digitsOnly = s.replace(/[^0-9]/g, '');
  if (digitsOnly.length) {
    // If someone wrote "40" (meaning 40K?) — we will not assume thousands,
    // we only treat explicit K as thousands. So "40" => "40".
    // If your data uses "40" to mean 40000, let me know and we can adapt.
    return digitsOnly;
  }

  return null;
}



function cleanPrice(price: any): number {
  if (price == null) return 0;
  let str = String(price).trim().replace(/[^0-9.,]/g, '');
  if (str.endsWith('.00') || str.endsWith(',00')) {
    str = str.slice(0, -3);
  }
  str = str.replace(/[.,]/g, '');
  return Number(str) || 0;
}

async function importWorkbook(buffer: Buffer | ArrayBuffer) {
  const wb = XLSX.read(buffer, { type: buffer instanceof Buffer ? 'buffer' : 'array' });
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rawRows: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    // Get the actual header row to check for required columns
    const headerRowRaw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })[0];
    const headerRow = Array.isArray(headerRowRaw) ? headerRowRaw : [];
    const sheetHeaders = headerRow.map(h => (typeof h === 'string' ? h : '').trim().toLowerCase().replace(/\s+/g, ''));

    // Only require core columns
    const requiredHeaders = ['makename', 'modelname', 'modelyear', 'partname', 'subpartname', 'stock'];
    const missing = requiredHeaders.filter(h => !sheetHeaders.includes(h));
    if (missing.length) {
      console.warn(`Skipping sheet "${sheetName}": missing columns: ${missing.join(', ')}`);
      continue; // skip this sheet
    }

    for (const raw of rawRows) {
      // Create a new object with trimmed headers as keys
      const normalizedRaw: Record<string, any> = {};
      for (const k in raw) {
        if (Object.prototype.hasOwnProperty.call(raw, k)) {
          normalizedRaw[(typeof k === 'string' ? k : '').trim()] = raw[k];
        }
      }

      // Map columns to our desired fields using headerMap
      const row: Record<string, any> = {};
      for (const [field, colName] of Object.entries(headerMap)) {
        const val = normalizedRaw[colName];
        // trim strings, leave other types as is
        row[field] = typeof val === 'string' ? val.trim() : val;
      }

      // ── your entire upsert block BELOW stays exactly the same ──

      // 1. Upsert Make
      const make = await prisma.make.upsert({
        where: { name: row.make },
        create: { name: row.make },
        update: {},
      });

      // 2. Upsert Model
      const model = await prisma.model.upsert({
        where: { name_makeId: { name: String(row.model), makeId: make.id } },
        create: { name: String(row.model), makeId: make.id },
        update: {},
      });

      // 3. Upsert Year
      const year = await prisma.year.upsert({
        where: { value: String(row.year) },
        create: { value: String(row.year) },
        update: {},
      });

      // 4. Upsert ModelYear
      const modelYear = await prisma.modelYear.upsert({
        where: { modelId_yearId: { modelId: model.id, yearId: year.id } },
        create: { modelId: model.id, yearId: year.id },
        update: {},
      });

      // 5. Upsert PartType
      const partType = await prisma.partType.upsert({
        where: { name: row.partType },
        create: { name: row.partType },
        update: {},
      });

      // 6. Upsert SubParts (do NOT split by comma, use full string)
      const subPartName = (row.subPart ?? '').toString().trim();
      const subPart = await prisma.subPart.upsert({
        where: { name_partTypeId: { name: subPartName, partTypeId: partType.id } },
        create: { name: subPartName, partTypeId: partType.id },
        update: {},
      });
      const subParts = [subPart];

      const baseSku = [
        String(row.make),
        String(row.model),
        String(row.year),
        String(row.partType),
        String(row.subPart)
      ].join('-').replace(/\s+/g, '').toUpperCase();

      // 7. Create Product
      const product = await prisma.product.upsert({
        where: { sku: baseSku },
        create: {
          sku: baseSku,
          modelYear: { connect: { id: modelYear.id } },
          partType: { connect: { id: partType.id } },
          inStock: row.inStock === 'Yes' || row.inStock === 'YES' || row.inStock === 'Part Available' || row.inStock === 'yes',
          // actualprice: Number(row.actualPrice),
          // discountedPrice: Number(row.discountedPrice),
          // miles: row.miles ? String(row.miles) : null,
          subParts: {
            connect: subParts.map(sp => ({ id: sp.id })),
          },
        },
        update: {
          inStock: row.inStock === 'Yes' || row.inStock === 'YES' || row.inStock === "Part Available" || row.inStock === "yes",
          // actualprice: Number(row.actualPrice),
          // discountedPrice: Number(row.discountedPrice),
          // miles: row.miles ? String(row.miles) : null,
          subParts: {
            set: subParts.map(sp => ({ id: sp.id })),
          },
          modelYear: { connect: { id: modelYear.id } },
          partType: { connect: { id: partType.id } },
        },
      });

      const title = `${String(row.year)} ${row.make} ${row.model} Used ${row.partType}`.trim();
      const description = `This ${row.make} ${row.model} ${row.partType} is from ${row.year} models. Each ${row.partType} is tested and ready to install and offers improved performance.

This Unit is perfect for anyone in the market for reliable used ${row.partType} that will offer superior results - a great addition to any repair project!`;

      // 8. Upsert ProductVariant (Variant 1)
      const miles1 = cleanMiles(row.miles);
      const variantSku1 = baseSku + '-' + (miles1 ? miles1.replace(/\s+/g, '').toUpperCase() : 'N/A');
      await prisma.productVariant_1.upsert({
        where: { sku: variantSku1 },
        create: {
          sku: variantSku1,
          productId: product.id,
          miles: miles1,
          actualprice: cleanPrice(row.actualPrice),
          discountedPrice: cleanPrice(row.discountedPrice),
          inStock: row.inStock === 'Yes' || row.inStock === 'YES' || row.inStock === 'Part Available' || row.inStock === 'yes',
          specification: subPartName,
          title: title,
          description: description,
          // ...add other fields as needed
        },
        update: {
          miles: miles1,
          actualprice: cleanPrice(row.actualPrice),
          discountedPrice: cleanPrice(row.discountedPrice),
          inStock: row.inStock === 'Yes' || row.inStock === 'YES' || row.inStock === 'Part Available' || row.inStock === 'yes',
          specification: subPartName,
          title: title,
          description: description,
          // ...add other fields as needed
        },
      });
      // console.log('row.miles2:', row.miles2, 'row.actualPrice2:', row.actualPrice2, 'row.discountedPrice2:', row.discountedPrice2);
      // 9. Upsert ProductVariant (Variant 2, if present)
      if (row.miles2 || row.actualPrice2 || row.discountedPrice2) {
        const miles2 = cleanMiles(row.miles2);
        const variantSku2 = baseSku + '-' + (miles2 ? miles2.replace(/\s+/g, '').toUpperCase() : 'N/A');
        await prisma.productVariant_1.upsert({
          where: { sku: variantSku2 },
          create: {
            sku: variantSku2,
            productId: product.id,
            miles: miles2,
            actualprice: cleanPrice(row.actualPrice2),
            discountedPrice: cleanPrice(row.discountedPrice2),
            inStock: row.inStock === 'Yes' || row.inStock === 'YES' || row.inStock === 'Part Available' || row.inStock === 'yes',
            specification: subPartName,
            title: title,
            description: description,
          },
          update: {
            miles: miles2,
            actualprice: cleanPrice(row.actualPrice2),
            discountedPrice: cleanPrice(row.discountedPrice2),
            inStock: row.inStock === 'Yes' || row.inStock === 'YES' || row.inStock === 'Part Available' || row.inStock === 'yes',
            specification: subPartName,
            title: title,
            description: description,
          }
        });
      }

    }
  }
}

async function main() {
  // — Option A: batch all XLSX in ./data/
  const dataDir = join(__dirname,'data');
  const files = readdirSync(dataDir).filter(f => extname(f).toLowerCase() === '.xlsx');
  for (const f of files) {
    const wb = XLSX.readFile(join(dataDir, f));
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const headers = Object.keys(XLSX.utils.sheet_to_json(sheet, { defval: '' })[0] || {});
    console.log(`File: ${f} | Headers:`, headers);
    const buf = await import('fs/promises').then(m => m.readFile(join(dataDir, f)));
    await importWorkbook(buf);
  }

  // — Option B: fetch from a list of URLs
  /*
  const urls = [
    'https://…/transmission.xlsx',
    'https://…/engine.xlsx',
    // …etc
  ];
  for (const url of urls) {
    const res = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer' });
    await importWorkbook(res.data);
  }
  */

  console.log('All imports complete');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
