import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { prisma, cleanupTestData, sessionCookie } from './helpers'
import { POST as phoneAdd } from '@/app/api/v1/account/phone/add/route'
import { POST as phoneVerify } from '@/app/api/v1/account/phone/verify/route'
import crypto from 'crypto'

/**
 * Regression for Richard's Must Fix 1 (step 15e review):
 *
 * UserIdentifier.identifier is globally unique. If User A parks an
 * unverified claim on +61400000000 and User B calls /add + /verify for the
 * same number, the final state must be:
 *   - one row for that phone
 *   - owned by User B
 *   - verified=true
 *   - PHONE_VERIFIED AuthEvent under User B (not A)
 *
 * Before the fix, /add's empty-update upsert left ownership on A, then
 * /verify flipped verified=true on A's row. A got a number they never
 * verified.
 */

async function createUserWithSession(label: string) {
  const email = `${label}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}@test.com`
  const bcrypt = await import('bcrypt')
  const passwordHash = await bcrypt.hash('TestPass123!', 12)
  const user = await prisma.user.create({
    data: {
      fullName: `User ${label}`,
      passwordHash,
      identifiers: {
        create: {
          type: 'EMAIL',
          identifier: email,
          verified: true,
          verifiedAt: new Date(),
        },
      },
    },
  })
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000)
  await prisma.session.create({ data: { userId: user.id, token, expiresAt } })
  return { userId: user.id, token }
}

function makeReq(url: string, token: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: sessionCookie(token),
    },
    body: JSON.stringify(body),
  })
}

beforeAll(async () => {
  await cleanupTestData()
  await prisma.phoneVerificationCode.deleteMany({})
})

afterEach(async () => {
  await cleanupTestData()
})

afterAll(async () => {
  await cleanupTestData()
})

describe('Phone verification — cross-user ownership transfer (regression)', () => {
  it('User B reclaiming User A\'s abandoned unverified phone ends with B owning a verified row, PHONE_VERIFIED under B, exactly one identifier row for that phone', async () => {
    const PHONE = '+61400099001'
    const alice = await createUserWithSession('alice')
    const bob = await createUserWithSession('bob')

    // Alice calls /add — creates an unverified identifier owned by Alice.
    const aliceAddRes = await phoneAdd(
      makeReq('http://localhost/api/v1/account/phone/add', alice.token, { phone: PHONE }),
    )
    expect(aliceAddRes.status).toBe(200)

    const aliceIdent = await prisma.userIdentifier.findUnique({ where: { identifier: PHONE } })
    expect(aliceIdent).not.toBeNull()
    expect(aliceIdent!.userId).toBe(alice.userId)
    expect(aliceIdent!.verified).toBe(false)

    // Bob calls /add on the same phone — ownership must transfer to Bob.
    const bobAddRes = await phoneAdd(
      makeReq('http://localhost/api/v1/account/phone/add', bob.token, { phone: PHONE }),
    )
    expect(bobAddRes.status).toBe(200)

    const afterBobAdd = await prisma.userIdentifier.findUnique({ where: { identifier: PHONE } })
    expect(afterBobAdd!.userId).toBe(bob.userId)
    expect(afterBobAdd!.verified).toBe(false)
    expect(afterBobAdd!.verifiedAt).toBeNull()

    // Grab the code Bob just received (hash only in DB — we need to read it
    // back via the dev-path sendSms stdout? No — we can't. We'll fetch the
    // latest unused code row and brute-verify by attempting each 6-digit
    // candidate is impractical. Instead we bypass by injecting a known
    // bcrypt hash directly for Bob's latest row.)
    const bcrypt = await import('bcrypt')
    const knownCode = '123456'
    const knownHash = await bcrypt.hash(knownCode, 4)
    await prisma.phoneVerificationCode.updateMany({
      where: { userId: bob.userId, phone: PHONE, usedAt: null },
      data: { codeHash: knownHash },
    })

    // Bob calls /verify with the known code.
    const bobVerifyRes = await phoneVerify(
      makeReq('http://localhost/api/v1/account/phone/verify', bob.token, {
        phone: PHONE,
        code: knownCode,
      }),
    )
    expect(bobVerifyRes.status).toBe(200)
    expect(await bobVerifyRes.json()).toEqual({ verified: true })

    // Final state: exactly one identifier row, owned by Bob, verified.
    const rows = await prisma.userIdentifier.findMany({ where: { identifier: PHONE } })
    expect(rows).toHaveLength(1)
    expect(rows[0].userId).toBe(bob.userId)
    expect(rows[0].verified).toBe(true)
    expect(rows[0].verifiedAt).not.toBeNull()

    // PHONE_VERIFIED AuthEvent is written under Bob, NOT Alice.
    const bobEvents = await prisma.authEvent.findMany({
      where: { userId: bob.userId, event: 'PHONE_VERIFIED' },
    })
    expect(bobEvents).toHaveLength(1)
    const aliceEvents = await prisma.authEvent.findMany({
      where: { userId: alice.userId, event: 'PHONE_VERIFIED' },
    })
    expect(aliceEvents).toHaveLength(0)
  })

  it('409 phone_taken remains when the existing row is VERIFIED under another user', async () => {
    const PHONE = '+61400099002'
    const alice = await createUserWithSession('alice')
    const bob = await createUserWithSession('bob')

    // Alice verifies first.
    await prisma.userIdentifier.create({
      data: {
        userId: alice.userId,
        type: 'PHONE',
        identifier: PHONE,
        verified: true,
        verifiedAt: new Date(),
      },
    })

    const res = await phoneAdd(
      makeReq('http://localhost/api/v1/account/phone/add', bob.token, { phone: PHONE }),
    )
    expect(res.status).toBe(409)

    // Alice still owns it, verified.
    const ident = await prisma.userIdentifier.findUnique({ where: { identifier: PHONE } })
    expect(ident!.userId).toBe(alice.userId)
    expect(ident!.verified).toBe(true)
  })
})
