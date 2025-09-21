
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();
const jsonFilePath = path.join(__dirname, 'orders.json');

async function main() {
    const ordersData = JSON.parse(fs.readFileSync(jsonFilePath, 'utf-8'));

    for (const orderData of ordersData) {
        try {
            await prisma.$transaction(async (tx) => {
                // 1. Create or update customer
                const customer = await tx.customer.upsert({
                    where: { email: orderData.customer.email },
                    update: { ...orderData.customer },
                    create: { ...orderData.customer },
                });

                // 2. Create the order
                await tx.order.create({
                    data: {
                        orderNumber: orderData.orderNumber,
                        source: orderData.source,
                        status: orderData.status,
                        subtotal: 0, // You might want to calculate this
                        totalAmount: orderData.totalAmount || 0,
                        customerId: customer.id,
                        shippingAddress: orderData.shippingAddress,
                        billingAddress: orderData.billingAddress,
                        addressType: orderData.addressType,
                        saleMadeBy: orderData.saleMadeBy,
                        orderDate: orderData.orderDate,
                        warranty: orderData.warranty,
                        notes: orderData.notes,
                        invoiceStatus: orderData.invoiceStatus,
                        invoiceSentAt: orderData.invoiceSentAt,
                        invoiceConfirmedAt: orderData.invoiceConfirmedAt,
                        items: {
                            create: orderData.items.map((item: any) => ({
                                ...item,
                                // These are placeholders, you need to find the correct product and variant
                                product_id: 1, 
                                productVariantId: 1,
                                sku: 'temp-sku', // Placeholder
                                quantity: 1, // Assuming quantity is 1
                                unitPrice: orderData.totalAmount || 0, // Simplification
                                lineTotal: orderData.totalAmount || 0, // Simplification
                            })),
                        },
                        yardInfo: orderData.yardInfo ? {
                            create: orderData.yardInfo,
                        } : undefined,
                        payments: orderData.payment ? {
                            create: {
                                provider: 'manual', // Assuming manual entry
                                amount: orderData.totalAmount || 0,
                                status: 'SUCCEEDED',
                                cardHolderName: customer.fullName,
                                // Fill other payment details as needed
                                cardNumber: 'XXXX-XXXX-XXXX-XXXX',
                                cardCvv: 'XXX',
                                cardExpiry: new Date(),
                                approvelCode: orderData.payment.approvelCode,
                                charged: orderData.payment.charged,
                                entity: orderData.payment.entity,
                            },
                        } : undefined,
                    },
                });
            });
            console.log(`Successfully created order: ${orderData.orderNumber}`);
        } catch (error) {
            console.error(`Failed to create order: ${orderData.orderNumber}`, error);
        }
    }
}

main()
    .catch((e) => {
        console.error(e);
        prisma.$disconnect();
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
