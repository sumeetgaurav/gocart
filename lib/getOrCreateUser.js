import { currentUser } from '@clerk/nextjs/server'
import prisma from '@/lib/prisma'

export async function getOrCreateUser() {
    const user = await currentUser()
    if (!user) return null

    const name = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.username || 'User'
    const email = user.emailAddresses[0]?.emailAddress ?? ''
    const image = user.imageUrl ?? ''

    return prisma.user.upsert({
        where: { id: user.id },
        update: { name, email, image },
        create: { id: user.id, name, email, image },
    })
}
