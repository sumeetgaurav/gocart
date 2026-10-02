import prisma from '@/lib/prisma'
import { getOrCreateUser } from '@/lib/getOrCreateUser'
import { NextResponse } from 'next/server'

export async function GET() {
    const user = await getOrCreateUser()
    if (!user) return NextResponse.json({ cartItems: {} }, { status: 401 })

    return NextResponse.json({ cartItems: user.cart })
}

export async function POST(request) {
    const user = await getOrCreateUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { cartItems } = await request.json()

    await prisma.user.update({
        where: { id: user.id },
        data: { cart: cartItems ?? {} },
    })

    return NextResponse.json({ success: true })
}
