import prisma from '@/lib/prisma'
import { getOrCreateUser } from '@/lib/getOrCreateUser'
import { NextResponse } from 'next/server'

export async function GET() {
    const user = await getOrCreateUser()
    if (!user) return NextResponse.json([], { status: 401 })

    const orders = await prisma.order.findMany({
        where: { userId: user.id },
        include: {
            address: true,
            orderItems: { include: { product: true } },
        },
        orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json(orders)
}

export async function POST(request) {
    const user = await getOrCreateUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { addressId, paymentMethod } = await request.json()
    if (!addressId) return NextResponse.json({ error: 'Address is required' }, { status: 400 })

    const address = await prisma.address.findFirst({ where: { id: addressId, userId: user.id } })
    if (!address) return NextResponse.json({ error: 'Address not found' }, { status: 400 })

    const cartItems = user.cart || {}
    const productIds = Object.keys(cartItems)
    if (productIds.length === 0) return NextResponse.json({ error: 'Cart is empty' }, { status: 400 })

    const products = await prisma.product.findMany({ where: { id: { in: productIds } } })

    const itemsByStore = {}
    for (const product of products) {
        const quantity = cartItems[product.id]
        if (!quantity) continue
        if (!itemsByStore[product.storeId]) itemsByStore[product.storeId] = []
        itemsByStore[product.storeId].push({ product, quantity })
    }

    if (Object.keys(itemsByStore).length === 0) {
        return NextResponse.json({ error: 'No valid items in cart' }, { status: 400 })
    }

    const orders = await prisma.$transaction(async (tx) => {
        const created = []
        for (const [storeId, items] of Object.entries(itemsByStore)) {
            const total = items.reduce((sum, item) => sum + item.product.price * item.quantity, 0)
            const order = await tx.order.create({
                data: {
                    userId: user.id,
                    storeId,
                    addressId,
                    total,
                    paymentMethod: paymentMethod === 'STRIPE' ? 'STRIPE' : 'COD',
                    orderItems: {
                        create: items.map((item) => ({
                            productId: item.product.id,
                            quantity: item.quantity,
                            price: item.product.price,
                        })),
                    },
                },
            })
            created.push(order)
        }
        await tx.user.update({ where: { id: user.id }, data: { cart: {} } })
        return created
    })

    return NextResponse.json(orders)
}
