import prisma from '@/lib/prisma'
import { NextResponse } from 'next/server'

export async function GET(request, { params }) {
    const { username } = await params

    const store = await prisma.store.findFirst({
        where: { username, isActive: true, status: 'approved' },
    })

    if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 })

    const products = await prisma.product.findMany({
        where: { storeId: store.id, inStock: true },
        include: { rating: true },
        orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ store, products })
}
