const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const xml2js = require('xml2js');

async function formatXmlFile() {
  try {
    const inputPath = path.join(__dirname, '../public/feed-file.xml');
    const outputPath = path.join(__dirname, '../public/feed-formatted.xml');
    
    // Read the XML file
    const xml = await readFile(inputPath, 'utf8');
    
    // Parse the XML
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(xml);
    
    // Convert back to formatted XML
    const builder = new xml2js.Builder({
      xmldec: { version: '1.0', encoding: 'UTF-8' },
      renderOpts: { pretty: true, indent: '  ', newline: '\n' }
    });
    
    const formattedXml = builder.buildObject(result);
    
    // Write the formatted XML back to a new file
    await writeFile(outputPath, formattedXml, 'utf8');
    
    console.log(`Formatted XML has been written to ${outputPath}`);
  } catch (error) {
    console.error('Error formatting XML:', error);
  }
}

// Run the formatter
formatXmlFile();
