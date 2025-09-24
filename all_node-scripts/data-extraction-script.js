

const XLSX = require('xlsx');
const fs = require('fs');

class OrderDataExtractor {
    constructor(filePath) {
        this.filePath = filePath;
        this.orders = [];
    }

    extractOrderNumber(text) {
        if (!text) return null;
        const match = text.toString().match(/PC#(\d{5})/);
        return match ? match[1] : null;
    }

    extractPhoneNumber(text) {
        if (!text) return null;
        const phoneMatch = text.toString().match(/(\d{10}|\d{3}-\d{3}-\d{4}|\(\d{3}\)\s?\d{3}-\d{4})/);
        return phoneMatch ? phoneMatch[0].replace(/\D/g, '') : null;
    }

    extractEmail(text) {
        if (!text) return null;
        const emailMatch = text.toString().match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/);
        return emailMatch ? emailMatch[0] : null;
    }

    extractApprovalCode(text) {
        if (!text) return null;
        const match = text.toString().match(/\b([A-Za-z0-9]{10,14})\b/);
        return match ? match[0] : null;
    }

    extractBOLNumber(text) {
        if (!text) return null;
        const match = text.toString().match(/BOL#(\d+)/i);
        return match ? match[1] : null;
    }

    extractDimensions(text) {
        if (!text) return null;
        const match = text.toString().match(/(\d+)\*(\d+)\*(\d+)/);
        if (match) {
            return {
                length: match[1],
                width: match[2],
                height: match[3]
            };
        }
        return null;
    }

    extractWeight(text) {
        if (!text) return null;
        const match = text.toString().match(/(\d+)lbs/i);
        return match ? match[1] : null;
    }

    extractCarrierInfo(text) {
        if (!text) return { carrierName: null, trackingNumber: null, eta: null };
        const carrierMatch = text.toString().match(/Carrier\s*:\s*([^\n\r]+)/i);
        const proMatch = text.toString().match(/PRO#\s*:\s*([^\n\r]+)/i);
        const etaMatch = text.toString().match(/ETA\s*:\s*([^\n\r]+)/i);
        
        return {
            carrierName: carrierMatch ? carrierMatch[1].trim() : null,
            trackingNumber: proMatch ? proMatch[1].trim() : null,
            eta: etaMatch ? etaMatch[1].trim() : null
        };
    }

    extractPartInfo(text) {
        if (!text) return {};
        const lines = text.split('\n');
        const yearMakeModelMatch = lines[0].match(/(\d{4})\s(.+)/);
        let year = '', make = '', model = '', partName = '';
        const vinMatch = text.match(/VIN#\s*([A-HJ-NPR-Z0-9]{17})/i);
        if (yearMakeModelMatch) {
            year = yearMakeModelMatch[1];
            const makeModel = yearMakeModelMatch[2].split(' ');
            make = makeModel.shift();
            model = makeModel.join(' ');
        }
        if (lines.length > 1) {
            partName = lines.slice(1).join(' ').replace(/VIN#\s*[A-HJ-NPR-Z0-9]{17}/i, '').trim();
        }
        return {
            yearName: year,
            makeName: make,
            modelName: model,
            partName: partName,
            vinNumber: vinMatch ? vinMatch[1] : null
        };
    }

    parseNotes(notesText) {
        if (!notesText) return [];
        const notes = [];
        const lines = notesText.toString().split(/\n|\r\n/).filter(line => line.trim());
        
        lines.forEach((line, index) => {
            const dateMatch = line.match(/(\d{2}\/\d{2})([A-Za-z]+)$/);
            let message = line;
            let timestamp = new Date().toISOString();
            
            if (dateMatch) {
                message = line.replace(dateMatch[0], '').trim();
                const [month, day] = dateMatch[1].split('/');
                const currentYear = new Date().getFullYear();
                timestamp = new Date(`${currentYear}-${month}-${day}`).toISOString();
            }
            
            if(message) {
                notes.push({
                    id: Date.now() + index,
                    actor: "By Agent",
                    message: message,
                    timestamp: timestamp
               });
            }
        });
        
        return notes;
    }

    determineWarranty(text) {
        if (!text) return "WARRANTY_90_DAYS";
        const warrantyText = text.toString().toLowerCase();
        if (warrantyText.includes("30")) return "WARRANTY_30_DAYS";
        if (warrantyText.includes("60")) return "WARRANTY_60_DAYS";
        if (warrantyText.includes("90")) return "WARRANTY_90_DAYS";
        if (warrantyText.includes("180") || warrantyText.includes("6 months")) return "WARRANTY_6_MONTHS";
        if (warrantyText.includes("365") || warrantyText.includes("1 year")) return "WARRANTY_1_YEAR";
        return "WARRANTY_90_DAYS";
    }

    extractAmount(text) {
        if (!text) return "0";
        const match = text.toString().replace(/,/g, '').match(/\$?(\d+(?:\.\d{2})?)/);
        return match ? match[1] : "0";
    }

    extractDate(dateText) {
        if (!dateText || typeof dateText !== 'string') return null;
        const datePatterns = [
            /(\d{2}\/\d{2}\/\d{4})/,
            /(\d{2}\/\d{2}\/\d{2})/,
            /(\d{2}\/\d{2})/,
            /(\d{4}-\d{2}-\d{2})/
        ];
        for (const pattern of datePatterns) {
            const match = dateText.match(pattern);
            if (match) {
                try {
                    let dateStr = match[1];
                    if (dateStr.length === 5) { // format MM/DD
                        dateStr = `${dateStr}/${new Date().getFullYear()}`;
                    }
                    if (dateStr.length === 8 && dateStr.includes('/')) { // format MM/DD/YY
                        const parts = dateStr.split('/');
                        const year = parseInt(parts[2], 10);
                        const fullYear = year < 70 ? 2000 + year : 1900 + year;
                        dateStr = `${parts[0]}/${parts[1]}/${fullYear}`;
                    }
                    const date = new Date(dateStr);
                    return date.toISOString();
                } catch (e) {
                    // ignore
                }
            }
        }
        return null;
    }

    extractOrders() {
        try {
            const workbook = XLSX.readFile(this.filePath);
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

            for (let i = 1; i < rawData.length; i++) {
                const row = rawData[i];
                if (!row || row.length === 0) continue;
                
                const orderData = this.extractOrderData(row, i);
                if (orderData) {
                    this.orders.push(orderData);
                }
            }
            return this.orders;
        } catch (error) {
            console.error('Error reading Excel file:', error);
            throw error;
        }
    }

    extractOrderData(row, rowIndex) {
        const orderNumber = this.extractOrderNumber(row[0]);
        if (!orderNumber) {
            console.log(`Row ${rowIndex + 1}: No order number found, skipping`);
            return null;
        }

        const partInfo = this.extractPartInfo(row[8]);
        const carrierInfo = this.extractCarrierInfo(row[45]);
        const dimensions = this.extractDimensions(row[43]);
        const weight = this.extractWeight(row[43]);
        const bolNumber = this.extractBOLNumber(row[43]);
        const poStatusText = row[10] || '';
        const poSentAt = poStatusText.toLowerCase().includes('sent') ? this.extractDate(poStatusText) : null;
        const poConfirmAt = poStatusText.toLowerCase().includes('confirmed') ? this.extractDate(poStatusText) : null;
        const invoiceStatusText = row[15] || '';
        const invoiceSentAt = invoiceStatusText.toLowerCase().includes('sent') ? this.extractDate(invoiceStatusText) : null;
        const invoiceConfirmedAt = invoiceStatusText.toLowerCase().includes('confirmed') ? this.extractDate(invoiceStatusText) : null;

        const yardInfoText = row[9] || '';
        const yardPriceMatch = yardInfoText.match(/\$(\d+)/);
        const yardShippingCostMatch = yardInfoText.match(/\+\s*\$(\d+)/);
        const yardMilesMatch = yardInfoText.match(/(\d+k)/i);

        const chargedDateText = row[12] ? String(row[12]) : '';
        const chargedDate = this.extractDate(chargedDateText.split('\n')[1]);
        const totalAmount = this.extractAmount(row[27]) || '0';
        const shippingAmount = this.extractAmount(row[18]) || '0';
        const subtotal = (parseFloat(totalAmount) - parseFloat(shippingAmount)).toFixed(2);

        const order = {
            orderNumber: orderNumber,
            source: row[1] || 'Unknown',
            saleMadeBy: row[31] || 'Unknown',
            status: row[36] || 'pending',
            currency: 'USD',
            customer: {
                email: this.extractEmail(row[3]),
                full_name: row[2] || 'Unknown',
                phone: this.extractPhoneNumber(row[4]),
                alternativePhone: null
            },
            billingSnapshot: {
                address: row[5] || 'Unknown',
                city: '', state: '', postalCode: '', country: 'US', company: null, addressType: 'Yet to Update'
            },
            shippingSnapshot: {
                address: row[6] || 'Unknown',
                city: '', state: '', postalCode: '', country: 'US', company: null, 
                addressType: row[7] ? (row[7].toLowerCase().includes('residential') ? 'RESIDENTIAL' : (row[7].toLowerCase().includes('commercial') ? 'COMMERCIAL' : 'TERMINAL')) : 'Yet to Update'
            },
            items: [{
                makeName: partInfo.makeName || 'Unknown',
                modelName: partInfo.modelName || 'Unknown',
                yearName: partInfo.yearName || 'Unknown',
                partName: partInfo.partName || 'Unknown',
                specification: '',
                milesPromised: row[34] || '0',
                pictureStatus: (row[44] && row[44].toLowerCase().includes('received')) ? 'yes' : 'no',
                quantity: 1,
                unitPrice: totalAmount,
                lineTotal: totalAmount
            }],
            yardInfo: {
                yardName: yardInfoText.split('\n')[0],
                yardAddress: (yardInfoText.match(/Address:\s*(.*)/) || [])[1] || '',
                attnName: (yardInfoText.match(/Name\s*:\s*(.*)/) || [])[1] || '',
                yardMobile: this.extractPhoneNumber((yardInfoText.match(/phone\s*:\s*(.*)/i) || [])[1] || ''),
                yardEmail: this.extractEmail((yardInfoText.match(/Email ID\s*:\s*(.*)/i) || [])[1] || ''),
                yardPrice: yardPriceMatch ? yardPriceMatch[1] : '0',
                yardMiles: yardMilesMatch ? yardMilesMatch[1] : '0',
                yardWarranty: this.determineWarranty(yardInfoText),
                yardShippingType: (row[17] && row[17].toLowerCase().includes('own')) ? 'Own Shipping' : 'Yard Shipping',
                yardShippingCost: yardShippingCostMatch ? yardShippingCostMatch[1] : '0'
            },
            payments: [{
                provider: 'STRIPE',
                currency: 'USD',
                amount: this.extractAmount(row[14] === 'Yes' ? row[16] : '0'),
                method: row[12] ? String(row[12]).split('\n')[0].trim() : 'UNKNOWN',
                status: 'SUCCEEDED',
                approvelCode: this.extractApprovalCode(row[11]),
                charged: row[14] || 'No',
                chargedDate: chargedDate,
                entity: row[13] || 'Unknown'
            }],
            poStatus: poStatusText ? (poStatusText.toLowerCase().includes('confirmed') ? 'conform' : (poStatusText.toLowerCase().includes('sent') ? 'sent' : 'pending')) : 'pending',
            poSentAt: poSentAt,
            poConfirmAt: poConfirmAt,
            invoiceStatus: invoiceStatusText ? (invoiceStatusText.toLowerCase().includes('confirmed') ? 'conform' : (invoiceStatusText.toLowerCase().includes('sent') ? 'sent' : 'pending')) : 'pending',
            invoiceSentAt: invoiceSentAt,
            invoiceConfirmedAt: invoiceConfirmedAt,
            carrierName: carrierInfo.carrierName || '',
            trackingNumber: carrierInfo.trackingNumber || '',
            vinNumber: partInfo.vinNumber,
            warranty: this.determineWarranty(row[33]),
            orderDate: this.extractDate(row[32] ? String(row[32]) : null),
            dimensions: dimensions,
            weight: weight,
            bolNumber: bolNumber,
            customerNotes: this.parseNotes(row[48]),
            yardNotes: this.parseNotes(row[47]),
            subtotal: subtotal,
            totalAmount: totalAmount,
            shippingAmount: shippingAmount,
            metadata: null,
            notes: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        return order;
    }

    saveToFile(filename = 'file1.json') {
        try {
            const jsonData = {
                extractedAt: new Date().toISOString(),
                totalOrders: this.orders.length,
                orders: this.orders
            };
            
            fs.writeFileSync(filename, JSON.stringify(jsonData, null, 2));
            console.log(`Data saved to ${filename}`);
        } catch (error) {
            console.error('Error saving file:', error);
            throw error;
        }
    }
}

function main() {
    try {
        const filePath = process.argv[2];
        if (!filePath) {
            console.error('Usage: node data-extraction-script.js <path-to-xlsx-file>');
            process.exit(1);
        }
        
        if (!fs.existsSync(filePath)) {
            console.error(`File not found: ${filePath}`);
            process.exit(1);
        }
        
        const extractor = new OrderDataExtractor(filePath);
        extractor.extractOrders();
        extractor.saveToFile();
        
        console.log(`Successfully extracted ${extractor.orders.length} orders.`);
        if (extractor.orders.length > 0) {
            console.log('Sample of first order:');
            console.log(JSON.stringify(extractor.orders[0], null, 2));
        }
    } catch (error) {
        console.error('An error occurred during execution:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = OrderDataExtractor;
