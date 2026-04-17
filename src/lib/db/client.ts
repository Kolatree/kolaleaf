import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../generated/prisma/client'
import { softDeleteExtension } from './prisma-soft-delete'

// Factory pattern lets TS infer the extended client type without erasing
// the model accessors to `unknown` (which is what a ReturnType alias on
// the generic $extends method produces).
function createPrisma() {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  }).$extends(softDeleteExtension)
}

type ExtendedPrismaClient = ReturnType<typeof createPrisma>

const globalForPrisma = globalThis as unknown as { prisma: ExtendedPrismaClient }

export const prisma: ExtendedPrismaClient = globalForPrisma.prisma ?? createPrisma()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
