import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client.js'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function main() {
  // Create AUD-NGN corridor
  const corridor = await prisma.corridor.upsert({
    where: { baseCurrency_targetCurrency: { baseCurrency: 'AUD', targetCurrency: 'NGN' } },
    update: {},
    create: {
      baseCurrency: 'AUD',
      targetCurrency: 'NGN',
      active: true,
      minAmount: 10,
      maxAmount: 50000,
      payoutProviders: ['FLUTTERWAVE', 'PAYSTACK'],
    },
  })

  // Create initial test rate
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

  console.log('Seed complete: AUD-NGN corridor with test rate')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
