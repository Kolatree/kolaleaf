import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client.js'
import bcrypt from 'bcrypt'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const EMAIL = 'demo@kolaleaf.com'
const PASSWORD = 'DemoPass123!'

async function main() {
  const corridor = await prisma.corridor.upsert({
    where: { baseCurrency_targetCurrency: { baseCurrency: 'AUD', targetCurrency: 'NGN' } },
    update: {},
    create: { baseCurrency: 'AUD', targetCurrency: 'NGN', active: true, minAmount: 10, maxAmount: 50000, payoutProviders: ['BUDPAY', 'FLUTTERWAVE'] },
  })
  const rate = await prisma.rate.findFirst({ where: { corridorId: corridor.id, provider: 'seed' }, orderBy: { effectiveAt: 'desc' } })
  if (!rate) {
    await prisma.rate.create({ data: { corridorId: corridor.id, provider: 'seed', wholesaleRate: 1050, spread: 0.007, customerRate: 1042.65, effectiveAt: new Date() } })
  }

  const existing = await prisma.userIdentifier.findFirst({ where: { identifier: EMAIL, type: 'EMAIL' } })
  let userId: string
  if (existing) {
    userId = existing.userId
    await prisma.user.update({ where: { id: userId }, data: { kycStatus: 'VERIFIED', passwordHash: await bcrypt.hash(PASSWORD, 12) } })
    await prisma.userIdentifier.update({ where: { id: existing.id }, data: { verified: true, verifiedAt: new Date() } })
    console.log('[seed-demo] updated existing demo user', userId)
  } else {
    const user = await prisma.user.create({
      data: {
        fullName: 'Demo User',
        passwordHash: await bcrypt.hash(PASSWORD, 12),
        kycStatus: 'VERIFIED',
        state: 'NSW',
        identifiers: { create: { type: 'EMAIL', identifier: EMAIL, verified: true, verifiedAt: new Date() } },
      },
    })
    userId = user.id
    console.log('[seed-demo] created demo user', userId)
  }

  const recip = await prisma.recipient.findFirst({ where: { userId } })
  if (!recip) {
    await prisma.recipient.create({
      data: { userId, fullName: 'Demo Recipient', bankName: 'GTBank', bankCode: '058', accountNumber: '0123456789' },
    })
    console.log('[seed-demo] created recipient')
  }

  console.log('\nLogin:\n  email:', EMAIL, '\n  password:', PASSWORD)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
