# Architect Brief
*Written by Architect. Read by Builder and Reviewer.*

---

## Step 1 — Project Scaffold + Database Schema

### Decisions
- Next.js 15 with TypeScript, Tailwind, App Router, src directory
- Prisma ORM with PostgreSQL (local Docker: `docker run --name kolaleaf-db -e POSTGRES_PASSWORD=kolaleaf -e POSTGRES_DB=kolaleaf -p 5432:5432 -d postgres:16`)
- vitest for testing
- DATABASE_URL: `postgresql://postgres:kolaleaf@localhost:5432/kolaleaf`
- Do NOT install payment SDKs, do NOT implement auth logic, do NOT build UI beyond default page

### Build Order
1. Initialize git repo with proper .gitignore (node_modules, .env, .next, prisma/*.db)
2. Scaffold Next.js 15: `npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --no-import-alias --use-npm`
3. Install additional deps: `npm install prisma @prisma/client decimal.js && npm install -D vitest @types/node`
4. Initialize Prisma: `npx prisma init`
5. Write the full Prisma schema (see schema section below)
6. Create .env with DATABASE_URL
7. Start Postgres Docker container
8. Run migration: `npx prisma migrate dev --name init`
9. Create prisma/seed.ts with AUD-NGN corridor and test rate
10. Configure seed in package.json: `"prisma": {"seed": "npx tsx prisma/seed.ts"}`
11. Install tsx: `npm install -D tsx`
12. Run seed: `npx prisma db seed`
13. Create project directory structure (empty index.ts files for future steps)
14. Create src/lib/db/client.ts (Prisma client singleton)
15. Configure vitest in vitest.config.ts
16. Write tests: Prisma connection, seed verification, enum validation
17. Run tests, verify all pass

### Prisma Schema

Write this EXACTLY to prisma/schema.prisma (replace the default):

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── ENUMS ──────────────────────────────────────────────

enum KycStatus {
  PENDING
  IN_REVIEW
  VERIFIED
  REJECTED
}

enum IdentifierType {
  EMAIL
  PHONE
  APPLE
  GOOGLE
}

enum TransferStatus {
  CREATED
  AWAITING_AUD
  AUD_RECEIVED
  PROCESSING_NGN
  NGN_SENT
  COMPLETED
  EXPIRED
  NGN_FAILED
  NGN_RETRY
  NEEDS_MANUAL
  REFUNDED
  CANCELLED
  FLOAT_INSUFFICIENT
}

enum PayoutProvider {
  FLUTTERWAVE
  PAYSTACK
}

enum ActorType {
  USER
  SYSTEM
  ADMIN
}

enum RewardStatus {
  PENDING
  ELIGIBLE
  PAID
  EXPIRED
}

enum ReportType {
  THRESHOLD
  SUSPICIOUS
  IFTI
}

// ─── MODELS ─────────────────────────────────────────────

model User {
  id            String           @id @default(cuid())
  fullName      String
  kycStatus     KycStatus        @default(PENDING)
  kycProviderId String?
  dailyLimit    Decimal          @default(10000) @db.Decimal(12, 2)
  referralCode  String           @unique @default(cuid())
  createdAt     DateTime         @default(now())
  updatedAt     DateTime         @updatedAt
  identifiers   UserIdentifier[]
  sessions      Session[]
  recipients    Recipient[]
  transfers     Transfer[]
  referredBy    Referral?        @relation("referred")
  referrals     Referral[]       @relation("referrer")
}

model UserIdentifier {
  id         String         @id @default(cuid())
  userId     String
  type       IdentifierType
  identifier String         @unique
  verified   Boolean        @default(false)
  verifiedAt DateTime?
  createdAt  DateTime       @default(now())
  user       User           @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Session {
  id        String   @id @default(cuid())
  userId    String
  token     String   @unique
  expiresAt DateTime
  ip        String?
  userAgent String?
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Recipient {
  id            String     @id @default(cuid())
  userId        String
  fullName      String
  bankName      String
  bankCode      String
  accountNumber String
  isVerified    Boolean    @default(false)
  createdAt     DateTime   @default(now())
  user          User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  transfers     Transfer[]
}

model Transfer {
  id                String         @id @default(cuid())
  userId            String
  recipientId       String
  corridorId        String
  sendAmount        Decimal        @db.Decimal(12, 2)
  sendCurrency      String         @default("AUD")
  receiveAmount     Decimal        @db.Decimal(15, 2)
  receiveCurrency   String         @default("NGN")
  exchangeRate      Decimal        @db.Decimal(12, 6)
  fee               Decimal        @default(0) @db.Decimal(12, 2)
  status            TransferStatus @default(CREATED)
  payidReference    String?
  payidProviderRef  String?
  payoutProvider    PayoutProvider?
  payoutProviderRef String?
  failureReason     String?
  retryCount        Int            @default(0)
  createdAt         DateTime       @default(now())
  updatedAt         DateTime       @updatedAt
  completedAt       DateTime?
  user              User           @relation(fields: [userId], references: [id])
  recipient         Recipient      @relation(fields: [recipientId], references: [id])
  corridor          Corridor       @relation(fields: [corridorId], references: [id])
  events            TransferEvent[]
}

model TransferEvent {
  id         String         @id @default(cuid())
  transferId String
  fromStatus TransferStatus
  toStatus   TransferStatus
  actor      ActorType
  actorId    String?
  metadata   Json?
  createdAt  DateTime       @default(now())
  transfer   Transfer       @relation(fields: [transferId], references: [id], onDelete: Cascade)
}

model Corridor {
  id             String     @id @default(cuid())
  baseCurrency   String
  targetCurrency String
  active         Boolean    @default(true)
  minAmount      Decimal    @db.Decimal(12, 2)
  maxAmount      Decimal    @db.Decimal(12, 2)
  payoutProviders Json      @default("[]")
  createdAt      DateTime   @default(now())
  transfers      Transfer[]
  rates          Rate[]

  @@unique([baseCurrency, targetCurrency])
}

model Rate {
  id            String   @id @default(cuid())
  corridorId    String
  provider      String?
  wholesaleRate Decimal  @db.Decimal(12, 6)
  spread        Decimal  @db.Decimal(8, 6)
  customerRate  Decimal  @db.Decimal(12, 6)
  effectiveAt   DateTime @default(now())
  expiresAt     DateTime?
  adminOverride Boolean  @default(false)
  setById       String?
  createdAt     DateTime @default(now())
  corridor      Corridor @relation(fields: [corridorId], references: [id])
}

model Referral {
  id                  String       @id @default(cuid())
  referrerId          String
  referredUserId      String       @unique
  referralCode        String
  rewardStatus        RewardStatus @default(PENDING)
  rewardAmount        Decimal?     @db.Decimal(12, 2)
  completedTransferId String?
  createdAt           DateTime     @default(now())
  referrer            User         @relation("referrer", fields: [referrerId], references: [id])
  referredUser        User         @relation("referred", fields: [referredUserId], references: [id])
}

model ComplianceReport {
  id         String     @id @default(cuid())
  type       ReportType
  transferId String?
  userId     String?
  details    Json
  reportedAt DateTime?
  austracRef String?
  createdAt  DateTime   @default(now())
}

model WebhookEvent {
  id          String   @id @default(cuid())
  provider    String
  eventId     String
  eventType   String
  payload     Json
  processed   Boolean  @default(false)
  processedAt DateTime?
  createdAt   DateTime @default(now())

  @@unique([provider, eventId])
}
```

### Directory Structure

Create these files (empty exports for now, just establishing the structure):

- `src/lib/db/client.ts` — Prisma client singleton (actual implementation)
- `src/lib/transfers/index.ts` — `export {}` placeholder
- `src/lib/payments/index.ts` — `export {}` placeholder
- `src/lib/kyc/index.ts` — `export {}` placeholder
- `src/lib/auth/index.ts` — `export {}` placeholder
- `src/lib/rates/index.ts` — `export {}` placeholder
- `src/lib/compliance/index.ts` — `export {}` placeholder

### Prisma Client Singleton (src/lib/db/client.ts)

```typescript
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma = globalForPrisma.prisma || new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

### Seed File (prisma/seed.ts)

```typescript
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

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
```

### Tests (tests/lib/db/foundation.test.ts)

```typescript
import { describe, it, expect, afterAll } from 'vitest'
import { PrismaClient, KycStatus, TransferStatus, IdentifierType } from '@prisma/client'

const prisma = new PrismaClient()

afterAll(async () => { await prisma.$disconnect() })

describe('Database foundation', () => {
  it('connects to PostgreSQL', async () => {
    const result = await prisma.$queryRaw`SELECT 1 as connected`
    expect(result).toEqual([{ connected: 1 }])
  })

  it('AUD-NGN corridor exists from seed', async () => {
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

  it('TransferStatus enum has all expected values', () => {
    const expected = [
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
```

### vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

### Flags
- Flag: Use `@db.Decimal(12, 2)` for money amounts. Never use float.
- Flag: The `cuid()` default for IDs. Not uuid. Shorter, URL-safe, sortable.
- Flag: `onDelete: Cascade` on UserIdentifier and Session (delete user = delete their identifiers and sessions). Do NOT cascade on Transfer or Recipient.
- Flag: The Corridor `@@unique([baseCurrency, targetCurrency])` constraint is critical for multi-corridor support.
- Flag: Add `"test": "vitest run"` and `"test:watch": "vitest"` to package.json scripts.

### Definition of Done
- [ ] Git repo initialized with .gitignore
- [ ] Next.js 15 app runs (`npm run dev`)
- [ ] Prisma schema compiles and migrates without errors
- [ ] Seed creates AUD-NGN corridor with test rate
- [ ] All 6 tests pass (`npm test`)
- [ ] Project directory structure matches the spec
- [ ] .env file exists with DATABASE_URL (and is in .gitignore)

---

## Builder Plan
*Builder adds their plan here before building. Architect reviews and approves.*

[Builder writes plan here]

Architect approval: [ ] Approved / [ ] Redirect — see notes below
