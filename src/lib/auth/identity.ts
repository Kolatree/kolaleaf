import { prisma } from '@/lib/db/client'
import type { IdentifierType } from '@/generated/prisma/client'

export async function addIdentifier(
  userId: string,
  type: IdentifierType | string,
  identifier: string,
) {
  return prisma.userIdentifier.create({
    data: {
      userId,
      type: type as IdentifierType,
      identifier,
    },
  })
}

export async function verifyIdentifier(identifierId: string) {
  return prisma.userIdentifier.update({
    where: { id: identifierId },
    data: { verified: true, verifiedAt: new Date() },
  })
}

export async function findUserByIdentifier(identifier: string) {
  const record = await prisma.userIdentifier.findUnique({
    where: { identifier },
    include: { user: true },
  })
  return record?.user ?? null
}

export async function getUserIdentifiers(userId: string) {
  return prisma.userIdentifier.findMany({ where: { userId } })
}
