import prisma from '@/lib/prisma'
import { NextResponse } from 'next/server'

export async function GET() {
    const products = await prisma.product.findMany({
        where: {
            inStock: true,
            store: { isActive: true, status: 'approved' },
        },
        include: {
            rating: { include: { user: { select: { name: true, image: true } } } },
            store: { select: { name: true, username: true, logo: true } },
        },
        orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(products)
}
