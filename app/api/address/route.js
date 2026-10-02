import prisma from '@/lib/prisma'
import { getOrCreateUser } from '@/lib/getOrCreateUser'
import { NextResponse } from 'next/server'

export async function GET() {
    const user = await getOrCreateUser()
    if (!user) return NextResponse.json([], { status: 401 })

    const addresses = await prisma.address.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(addresses)
}

export async function POST(request) {
    const user = await getOrCreateUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { name, email, street, city, state, zip, country, phone } = await request.json()

    const address = await prisma.address.create({
        data: { userId: user.id, name, email, street, city, state, zip, country, phone },
    })

    return NextResponse.json(address)
}
