

import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';

const xlsxFilePath = path.join(__dirname, 'part-central-order.csv'); // It's actually an xlsx file
const jsonFilePath = path.join(__dirname, 'orders.json');

// Function to clean strings
const cleanString = (str: string | null | undefined) => {
    return str ? str.replace(/\r\n/g, ' ').trim() : null;
};

// Function to clean phone numbers
const cleanPhone = (phone: string | null | undefined) => {
    return phone ? String(phone).replace(/\D/g, '') : null;
};

// Function to convert Excel serial date to JS Date
const convertExcelDate = (excelDate: number) => {
    if (!excelDate) return null;
    return new Date(Math.round((excelDate - 25569) * 86400 * 1000));
};

// Function to parse the PART column
const parsePart = (partString: string) => {
    if (!partString) return {};
    const cleanedPartString = cleanString(partString) || '';
    const yearMatch = cleanedPartString.match(/^\d{4}/);
    const vinMatch = cleanedPartString.match(/VIN#\s*(\S+)/);

    const year = yearMatch ? parseInt(yearMatch[0], 10) : null;
    const vinNumber = vinMatch ? vinMatch[1] : null;

    let remainingString = cleanedPartString.replace(/^\d{4}\s*/, '').replace(/VIN#\s*\S+/, '').trim();
    const parts = remainingString.split(' ');
    const make = parts.length > 0 ? parts[0] : null;
    const model = parts.length > 1 ? parts[1] : null;

    // Extract Part Name (e.g., Engine, Transmission)
    const partNameMatch = remainingString.match(/(Engine|Transmission|Transfer Case)/i);
    const partName = partNameMatch ? partNameMatch[0] : null;

    // Refine specification
    let specification = remainingString;
    if (make) specification = specification.replace(make, '').trim();
    if (model) specification = specification.replace(model, '').trim();
    if (partName) specification = specification.replace(partName, '').trim();


    return {
        year,
        makeName: make,
        modelName: model,
        partName: partName,
        specification: specification.replace(/\s+/g, ' ').trim(),
        vinNumber,
    };
};

// Function to parse the YARD INFO column
const parseYardInfo = (yardString: string) => {
    if (!yardString) return {};
    const cleanedYardString = cleanString(yardString) || '';
    const addressMatch = cleanedYardString.match(/Address:(.*?)(Name:|Phone:|Email:|$)/);
    const nameMatch = cleanedYardString.match(/Name:(.*?)(Phone:|Email:|$)/);
    const phoneMatch = cleanedYardString.match(/Phone:\s*(\S+)/);
    const emailMatch = cleanedYardString.match(/Email:\s*(\S+)/);
    const priceMatch = cleanedYardString.match(/\$(\d+)/);
    const shippingMatch = cleanedYardString.match(/\+(\d+)Shipping/);
    const milesMatch = cleanedYardString.match(/(\d+k)/);
    const warrantyMatch = cleanedYardString.match(/(\d+\s+days)/);

    return {
        yardName: cleanedYardString.split('Address:')[0].trim(),
        yardAddress: addressMatch ? addressMatch[1].trim() : null,
        attnName: nameMatch ? nameMatch[1].trim() : null,
        yardMobile: phoneMatch ? cleanPhone(phoneMatch[1]) : null,
        yardEmail: emailMatch ? emailMatch[1] : null,
        yardPrice: priceMatch ? parseInt(priceMatch[1], 10) : null,
        yardShippingCost: shippingMatch ? parseInt(shippingMatch[1], 10) : null,
        yardMiles: milesMatch ? milesMatch[1] : null,
        yardWarranty: warrantyMatch ? warrantyMatch[1] : null,
    };
};

// Function to parse Invoice Status
const parseInvoiceStatus = (statusString: string) => {
    if (!statusString) return {};
    const cleanedStatusString = cleanString(statusString) || '';
    const sentMatch = cleanedStatusString.match(/Invoice sent (\d{2}\/\d{2})/);
    const confirmedMatch = cleanedStatusString.match(/Invoice Confirmed (\d{2}\/\d{2})/);

    // Assuming the year is the current year or needs to be derived from sale date
    const currentYear = new Date().getFullYear();
    const invoiceSentAt = sentMatch ? new Date(`${sentMatch[1]}/${currentYear}`) : null;
    const invoiceConfirmedAt = confirmedMatch ? new Date(`${confirmedMatch[1]}/${currentYear}`) : null;

    return {
        invoiceStatus: 'Yes',
        invoiceSentAt,
        invoiceConfirmedAt,
    };
};

try {
    const workbook = XLSX.readFile(xlsxFilePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    const headers = data[0] as string[];
    const rows = data.slice(1);

    const orders = rows.map((rowArray: any) => {
        const row: any = {};
        headers.forEach((header, index) => {
            row[header] = rowArray[index];
        });

        const partInfo = parsePart(row['PART']);
        const yardInfo = parseYardInfo(row['YARD INFO']);
        const invoiceInfo = parseInvoiceStatus(row['INVOICE STATUS']);

        return {
            orderNumber: cleanString(row['Order No']),
            source: cleanString(row['Lead']),
            customer: {
                fullName: cleanString(row['CUSTOMER NAME']),
                email: cleanString(row['EMAIL ID']),
                phone: cleanPhone(row['PHONE NUMBER']),
            },
            billingAddress: cleanString(row['BILLING ADDRESS']),
            shippingAddress: cleanString(row['SHIPPING ADDRESS']),
            addressType: cleanString(row['Residential / Commercial Unloading Eqp'])?.toLowerCase().includes('commercial') ? 'COMMERCIAL' : 'RESIDENTIAL',
            items: [
                {
                    ...partInfo,
                    milesPromised: cleanString(row['Miles Promised']),
                }
            ],
            yardInfo: yardInfo,
            poStatus: cleanString(row['PO STATUS']),
            payment: {
                approvelCode: cleanString(row['APPROVAL CODE']),
                entity: cleanString(row['Entity']),
                charged: cleanString(row['Charged']),
            },
            ...invoiceInfo,
            totalAmount: row['SELLING PRICE'] ? parseFloat(String(row['SELLING PRICE']).replace(/[^\d.-]/g, '')) : null,
            saleMadeBy: cleanString(row['Sale Made by']),
            orderDate: convertExcelDate(row['Date of sale']),
            warranty: cleanString(row['Warranty']),
            status: 'invoice sent', // Fixed status as requested
            notes: cleanString(row['ORDER NOTES']),
        };
    });

    fs.writeFileSync(jsonFilePath, JSON.stringify(orders, null, 2));
    console.log(`Successfully parsed ${orders.length} orders. Review the output at: ${jsonFilePath}`);
} catch (error) {
    console.error("Error processing the Excel file:", error);
}
