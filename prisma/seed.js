const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const VENDOR_ID = 'seed_vendor_1'
const STORE_ID = 'seed_store_1'

const customers = [
    { id: 'seed_customer_1', name: 'Kristin Watson', email: 'kristin@example.com', image: 'https://i.pravatar.cc/150?img=5' },
    { id: 'seed_customer_2', name: 'Jenny Wilson', email: 'jenny@example.com', image: 'https://i.pravatar.cc/150?img=9' },
    { id: 'seed_customer_3', name: 'Bessie Cooper', email: 'bessie@example.com', image: 'https://i.pravatar.cc/150?img=20' },
]

const products = [
    { name: 'Modern table lamp', description: "Modern table lamp with a sleek design. It's perfect for any room. It's made of high-quality materials and comes with a lifetime warranty.", mrp: 40, price: 29, category: 'Decoration', seed: 'lamp' },
    { name: 'Smart speaker gray', description: "Smart speaker with a sleek design. It's perfect for any room. It's made of high-quality materials and comes with a lifetime warranty.", mrp: 50, price: 29, category: 'Speakers', seed: 'speaker' },
    { name: 'Smart watch white', description: "Smart watch with a sleek design. It's perfect for any room. It's made of high-quality materials and comes with a lifetime warranty.", mrp: 60, price: 29, category: 'Watch', seed: 'watchwhite' },
    { name: 'Wireless headphones', description: "Wireless headphones with a sleek design. It's perfect for any room. It's made of high-quality materials and comes with a lifetime warranty.", mrp: 70, price: 29, category: 'Headphones', seed: 'headphones' },
    { name: 'Smart watch black', description: "Smart watch with a sleek design. It's perfect for any room. It's made of high-quality materials and comes with a lifetime warranty.", mrp: 49, price: 29, category: 'Watch', seed: 'watchblack' },
    { name: 'Security Camera', description: "Security Camera with a sleek design. It's perfect for any room. It's made of high-quality materials and comes with a lifetime warranty.", mrp: 59, price: 29, category: 'Camera', seed: 'camera' },
    { name: 'Smart Pen for iPad', description: "Smart Pen for iPad with a sleek design. It's perfect for any room. It's made of high-quality materials and comes with a lifetime warranty.", mrp: 89, price: 29, category: 'Pen', seed: 'pen' },
    { name: 'Home Theater', description: "Home Theater with a sleek design. It's perfect for any room. It's made of high-quality materials and comes with a lifetime warranty.", mrp: 99, price: 29, category: 'Theater', seed: 'theater' },
    { name: 'Apple Wireless Earbuds', description: "Apple Wireless Earbuds with a sleek design. It's perfect for any room. It's made of high-quality materials and comes with a lifetime warranty.", mrp: 89, price: 29, category: 'Earbuds', seed: 'earbuds' },
    { name: 'Apple Smart Watch', description: "Apple Smart Watch with a sleek design. It's perfect for any room. It's made of high-quality materials and comes with a lifetime warranty.", mrp: 179, price: 29, category: 'Watch', seed: 'applewatch' },
    { name: 'RGB Gaming Mouse', description: "RGB Gaming Mouse with a sleek design. It's perfect for any room. It's made of high-quality materials and comes with a lifetime warranty.", mrp: 39, price: 29, category: 'Mouse', seed: 'mouse' },
    { name: 'Smart Home Cleaner', description: "Smart Home Cleaner with a sleek design. It's perfect for any room. It's made of high-quality materials and comes with a lifetime warranty.", mrp: 199, price: 29, category: 'Cleaner', seed: 'cleaner' },
]

const reviews = [
    "I was a bit skeptical at first, but this product turned out to be even better than I imagined. The quality feels premium and it delivers exactly what was promised.",
    "This product is great. I love it! My new purchase is so much faster and easier to work with than my old one.",
    "Overall, I'm very happy with this purchase. It works as described and feels durable. Highly recommend it.",
]

async function main() {
    console.log('Seeding vendor + store...')

    await prisma.user.upsert({
        where: { id: VENDOR_ID },
        update: {},
        create: {
            id: VENDOR_ID,
            name: 'Great Stack',
            email: 'vendor@gocart.example',
            image: 'https://i.pravatar.cc/150?img=68',
        },
    })

    await prisma.store.upsert({
        where: { id: STORE_ID },
        update: {},
        create: {
            id: STORE_ID,
            userId: VENDOR_ID,
            name: 'Happy Shop',
            description: "At Happy Shop, we believe shopping should be simple, smart, and satisfying. Whether you're hunting for the latest electronics or home essentials, we've got it all under one digital roof.",
            username: 'happyshop',
            address: '3rd Floor, Happy Shop, New Building, 123 Street, NY, US',
            status: 'approved',
            isActive: true,
            logo: 'https://picsum.photos/seed/happyshop-logo/200/200',
            email: 'happyshop@example.com',
            contact: '+0 1234567890',
        },
    })

    for (const customer of customers) {
        await prisma.user.upsert({
            where: { id: customer.id },
            update: {},
            create: customer,
        })
    }

    console.log('Seeding products + ratings...')

    for (const [index, item] of products.entries()) {
        const product = await prisma.product.upsert({
            where: { id: `seed_product_${index + 1}` },
            update: {},
            create: {
                id: `seed_product_${index + 1}`,
                name: item.name,
                description: item.description,
                mrp: item.mrp,
                price: item.price,
                category: item.category,
                storeId: STORE_ID,
                images: [
                    `https://picsum.photos/seed/${item.seed}-1/500/500`,
                    `https://picsum.photos/seed/${item.seed}-2/500/500`,
                ],
            },
        })

        const ratingCount = 1 + (index % 3)
        for (let i = 0; i < ratingCount; i++) {
            const customer = customers[i % customers.length]
            await prisma.rating.upsert({
                where: {
                    userId_productId_orderId: {
                        userId: customer.id,
                        productId: product.id,
                        orderId: `seed_order_${index}_${i}`,
                    },
                },
                update: {},
                create: {
                    userId: customer.id,
                    productId: product.id,
                    orderId: `seed_order_${index}_${i}`,
                    rating: 4 + (i % 2),
                    review: reviews[i % reviews.length],
                },
            })
        }
    }

    console.log('Seed complete.')
}

main()
    .catch((err) => {
        console.error(err)
        process.exitCode = 1
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
