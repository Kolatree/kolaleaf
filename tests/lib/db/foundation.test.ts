import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../../src/generated/prisma/client'
import { KycStatus, TransferStatus, IdentifierType } from '../../../src/generated/prisma/enums'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })


describe('Database foundation', () => {
  // Ensure seed data exists (other tests may clean the DB)
  beforeAll(async () => {
    await prisma.corridor.upsert({
      where: { baseCurrency_targetCurrency: { baseCurrency: 'AUD', targetCurrency: 'NGN' } },
      update: {},
      create: {
        baseCurrency: 'AUD',
        targetCurrency: 'NGN',
        active: true,
        minAmount: 10,
        maxAmount: 50000,
        payoutProviders: ['FLUTTERWAVE', 'BUDPAY'],
      },
    }).then(async (corridor) => {
      const existing = await prisma.rate.findFirst({ where: { corridorId: corridor.id } })
      if (!existing) {
        await prisma.rate.create({
          data: {
            corridorId: corridor.id,
            provider: 'seed',
            wholesaleRate: 1050.00,
            spread: 0.007,
            customerRate: 1042.65,
            effectiveAt: new Date(),
          },
        })
      }
    })
  })

  it('connects to PostgreSQL', async () => {
    const result = await prisma.$queryRaw`SELECT 1 as connected` as { connected: number }[]
    expect(result).toEqual([{ connected: 1 }])
  })

  it('AUD-NGN corridor exists', async () => {
    const corridor = await prisma.corridor.findUnique({
      where: { baseCurrency_targetCurrency: { baseCurrency: 'AUD', targetCurrency: 'NGN' } },
    })
    expect(corridor).not.toBeNull()
    expect(corridor!.active).toBe(true)
    expect(Number(corridor!.minAmount)).toBe(10)
    expect(Number(corridor!.maxAmount)).toBe(50000)
  })

  it('test rate exists for AUD-NGN corridor', async () => {
    const corridor = await prisma.corridor.findUnique({
      where: { baseCurrency_targetCurrency: { baseCurrency: 'AUD', targetCurrency: 'NGN' } },
    })
    const rate = await prisma.rate.findFirst({
      where: { corridorId: corridor!.id },
      orderBy: { effectiveAt: 'desc' },
    })
    expect(rate).not.toBeNull()
    expect(Number(rate!.customerRate)).toBeGreaterThan(0)
  })

  it('TransferStatus enum has all expected values (incl. NULL_STATE sentinel)', () => {
    // Step 31 added NULL_STATE as a sentinel used exclusively as the
    // fromStatus on the initial TransferEvent — never as a live
    // Transfer.status value.
    const expected = [
      'NULL_STATE',
      'CREATED', 'AWAITING_AUD', 'AUD_RECEIVED', 'PROCESSING_NGN',
      'NGN_SENT', 'COMPLETED', 'EXPIRED', 'NGN_FAILED', 'NGN_RETRY',
      'NEEDS_MANUAL', 'REFUNDED', 'CANCELLED', 'FLOAT_INSUFFICIENT',
    ]
    const actual = Object.values(TransferStatus)
    expect(actual).toEqual(expect.arrayContaining(expected))
    expect(actual.length).toBe(expected.length)
  })

  it('KycStatus enum has all expected values', () => {
    expect(Object.values(KycStatus)).toEqual(['PENDING', 'IN_REVIEW', 'VERIFIED', 'REJECTED'])
  })

  it('IdentifierType enum has all expected values', () => {
    expect(Object.values(IdentifierType)).toEqual(['EMAIL', 'PHONE', 'APPLE', 'GOOGLE'])
  })
})
