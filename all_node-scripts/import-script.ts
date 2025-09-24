import { PrismaClient, Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
    const filePath = path.join(__dirname, 'file1.json');
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(fileContent);

    for (const order of data.orders) {
        try {
            // 1. Prepare Customer Data (we still need to connect it)
            const customer = await prisma.customer.upsert({
                where: { email: order.customer.email || '' },
                update: {},
                create: {
                    email: order.customer.email || `missing-email-${Date.now()}@example.com`,
                    full_name: order.customer.full_name || 'Unknown Customer',
                    phone: order.customer.phone ? parseInt(order.customer.phone, 10) : null,
                },
            });

            // 2. Prepare Order Data for Upsert
            const orderDataForCreate: Prisma.OrderCreateInput = {
                orderNumber: order.orderNumber,
                source: order.source,
                saleMadeBy: order.saleMadeBy,
                status: order.status,
                currency: order.currency,
                subtotal: order.subtotal,
                totalAmount: order.totalAmount,
                shippingAmount: order.shippingAmount,
                vinNumber: order.vinNumber,
                warranty: order.warranty,
                orderDate: order.orderDate ? new Date(order.orderDate) : null,
                carrierName: order.carrierName,
                trackingNumber: order.trackingNumber,
                poStatus: order.poStatus,
                poSentAt: order.poSentAt ? new Date(order.poSentAt) : null,
                poConfirmAt: order.poConfirmAt ? new Date(order.poConfirmAt) : null,
                invoiceStatus: order.invoiceStatus,
                invoiceSentAt: order.invoiceSentAt ? new Date(order.invoiceSentAt) : null,
                invoiceConfirmedAt: order.invoiceConfirmedAt ? new Date(order.invoiceConfirmedAt) : null,
                customerNotes: order.customerNotes || [],
                yardNotes: order.yardNotes || [],
                billingAddress: order.billingSnapshot.address,
                shippingAddress: order.shippingSnapshot.address,
                addressType: order.shippingSnapshot.addressType === 'RESIDENTIAL' ? 'RESIDENTIAL' : (order.shippingSnapshot.addressType === 'COMMERCIAL' ? 'COMMERCIAL' : 'TERMINAL'),
                customer: {
                    connect: { id: customer.id },
                },
                items: {
                    create: order.items.map((item: any) => ({
                        makeName: item.makeName,
                        modelName: item.modelName,
                        yearName: item.yearName,
                        partName: item.partName,
                        specification: item.specification,
                        milesPromised: item.milesPromised,
                        pictureStatus: item.pictureStatus,
                        quantity: item.quantity,
                        unitPrice: item.unitPrice,
                        lineTotal: item.lineTotal,
                        productVariantId: 1, // Placeholder
                        product_id: 1,       // Placeholder
                        sku: 'DEFAULT-SKU'   // Placeholder
                    })),
                },
                payments: {
                    create: order.payments.map((p: any) => ({
                        provider: p.provider,
                        currency: p.currency,
                        amount: p.amount,
                        method: p.method,
                        status: p.status,
                        approvelCode: p.approvelCode,
                        charged: p.charged,
                        chargedDate: p.chargedDate ? new Date(p.chargedDate) : null,
                        entity: p.entity,
                        cardHolderName: 'N/A',
                        cardNumber: 'N/A',
                        cardCvv: 'N/A',
                        cardExpiry: new Date(),
                    })),
                },
                yardInfo: {
                    create: {
                        yardName: order.yardInfo.yardName,
                        yardAddress: order.yardInfo.yardAddress,
                        attnName: order.yardInfo.attnName,
                        yardMobile: order.yardInfo.yardMobile,
                        yardEmail: order.yardInfo.yardEmail,
                        yardPrice: order.yardInfo.yardPrice,
                        yardMiles: order.yardInfo.yardMiles,
                        yardWarranty: order.yardInfo.yardWarranty,
                        yardShippingType: order.yardInfo.yardShippingType,
                        yardShippingCost: order.yardInfo.yardShippingCost,
                    },
                },
            };

            const orderDataForUpdate: Prisma.OrderUpdateInput = {
                ...orderDataForCreate,
                customer: { connect: { id: customer.id } }, // Ensure customer is connected on update too
                items: {
                    deleteMany: {},
                    create: order.items.map((item: any) => ({
                        makeName: item.makeName,
                        modelName: item.modelName,
                        yearName: item.yearName,
                        partName: item.partName,
                        specification: item.specification,
                        milesPromised: item.milesPromised,
                        pictureStatus: item.pictureStatus,
                        quantity: item.quantity,
                        unitPrice: item.unitPrice,
                        lineTotal: item.lineTotal,
                        productVariantId: 1, // Placeholder
                        product_id: 1,       // Placeholder
                        sku: 'DEFAULT-SKU'   // Placeholder
                    })),
                },
                payments: {
                    deleteMany: {},
                    create: order.payments.map((p: any) => ({
                        provider: p.provider,
                        currency: p.currency,
                        amount: p.amount,
                        method: p.method,
                        status: p.status,
                        approvelCode: p.approvelCode,
                        charged: p.charged,
                        chargedDate: p.chargedDate ? new Date(p.chargedDate) : null,
                        entity: p.entity,
                        cardHolderName: 'N/A',
                        cardNumber: 'N/A',
                        cardCvv: 'N/A',
                        cardExpiry: new Date(),
                    })),
                },
                yardInfo: {
                    upsert: {
                        create: {
                            yardName: order.yardInfo.yardName,
                            yardAddress: order.yardInfo.yardAddress,
                            attnName: order.yardInfo.attnName,
                            yardMobile: order.yardInfo.yardMobile,
                            yardEmail: order.yardInfo.yardEmail,
                            yardPrice: order.yardInfo.yardPrice,
                            yardMiles: order.yardInfo.yardMiles,
                            yardWarranty: order.yardInfo.yardWarranty,
                            yardShippingType: order.yardInfo.yardShippingType,
                            yardShippingCost: order.yardInfo.yardShippingCost,
                        },
                        update: {
                            yardName: order.yardInfo.yardName,
                            yardAddress: order.yardInfo.yardAddress,
                            attnName: order.yardInfo.attnName,
                            yardMobile: order.yardInfo.yardMobile,
                            yardEmail: order.yardInfo.yardEmail,
                            yardPrice: order.yardInfo.yardPrice,
                            yardMiles: order.yardInfo.yardMiles,
                            yardWarranty: order.yardInfo.yardWarranty,
                            yardShippingType: order.yardInfo.yardShippingType,
                            yardShippingCost: order.yardInfo.yardShippingCost,
                        }
                    }
                },
            };

            // 3. Upsert Order
            await prisma.order.upsert({
                where: { orderNumber: order.orderNumber },
                create: orderDataForCreate,
                update: orderDataForUpdate,
            });

            console.log(`Successfully upserted order #${order.orderNumber}`);

        } catch (e) {
            console.error(`Failed to upsert order #${order.orderNumber}:`, e);
        }
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });