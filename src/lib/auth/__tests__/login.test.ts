import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/lib/db/client'
import { registerUser } from '../register'
import { loginUser, EmailNotVerifiedError } from '../login'
import { hashPassword } from '../password'

beforeEach(async () => {
  await prisma.referral.deleteMany({})
  await prisma.session.deleteMany({})
  await prisma.twoFactorChallenge.deleteMany({})
  await prisma.userIdentifier.deleteMany({})
  await prisma.authEvent.deleteMany({})
  await prisma.user.deleteMany({ where: { fullName: { startsWith: 'LoginTest' } } })
})

afterAll(async () => {
  await prisma.referral.deleteMany({})
  await prisma.session.deleteMany({})
  await prisma.twoFactorChallenge.deleteMany({})
  await prisma.userIdentifier.deleteMany({})
  await prisma.authEvent.deleteMany({})
  await prisma.user.deleteMany({ where: { fullName: { startsWith: 'LoginTest' } } })
})

describe('login service', () => {
  async function createVerifiedUser(email: string, password: string, name: string) {
    const { user } = await registerUser({
      fullName: name,
      email,
      password,
    })
    // Registration creates email as UNVERIFIED (Step 15d). Flip it here so
    // tests that want a ready-to-use account can call this helper.
    await prisma.userIdentifier.updateMany({
      where: { userId: user.id, type: 'EMAIL' },
      data: { verified: true, verifiedAt: new Date() },
    })
    return user
  }

  it('logs in with correct email and password', async () => {
    await createVerifiedUser('login1@example.com', 'CorrectPass1!', 'LoginTest One')
    const result = await loginUser({
      identifier: 'login1@example.com',
      password: 'CorrectPass1!',
    })
    expect(result.session.token).toMatch(/^[a-f0-9]{64}$/)
    expect(result.requires2FA).toBe(false)
  })

  it('logs in with phone identifier', async () => {
    const user = await createVerifiedUser('login2@example.com', 'CorrectPass2!', 'LoginTest Two')
    // Add a phone identifier and verify it
    await prisma.userIdentifier.create({
      data: { userId: user.id, type: 'PHONE', identifier: '+61400000099', verified: true, verifiedAt: new Date() },
    })
    const result = await loginUser({
      identifier: '+61400000099',
      password: 'CorrectPass2!',
    })
    expect(result.user.id).toBe(user.id)
  })

  it('throws on wrong password', async () => {
    await createVerifiedUser('login3@example.com', 'CorrectPass3!', 'LoginTest Three')
    await expect(
      loginUser({ identifier: 'login3@example.com', password: 'WrongPass!' })
    ).rejects.toThrow('Invalid credentials')
  })

  it('throws EmailNotVerifiedError for an unverified email (verify-then-login gate)', async () => {
    // Verify-then-login (post Step 15d revisit): valid credentials against an
    // unverified email must NOT issue a session — the route catches this error,
    // sends a fresh code, and bounces the user to /verify-email.
    const pw = await hashPassword('SomePass1!')
    const user = await prisma.user.create({
      data: {
        fullName: 'LoginTest Unverified',
        passwordHash: pw,
        identifiers: {
          create: { type: 'EMAIL', identifier: 'unverified@example.com', verified: false },
        },
      },
    })
    await expect(
      loginUser({ identifier: 'unverified@example.com', password: 'SomePass1!' }),
    ).rejects.toBeInstanceOf(EmailNotVerifiedError)
    // No session created — sanity-check downstream contract.
    const sessions = await prisma.session.findMany({ where: { userId: user.id } })
    expect(sessions).toHaveLength(0)
  })

  it('returns requires2FA=true with method=TOTP when TOTP 2FA is enabled', async () => {
    const user = await createVerifiedUser('login5@example.com', 'CorrectPass5!', 'LoginTest 2FA')
    await prisma.user.update({
      where: { id: user.id },
      data: {
        twoFactorMethod: 'TOTP',
        twoFactorSecret: 'FAKESECRET',
        twoFactorEnabledAt: new Date(),
      },
    })
    const result = await loginUser({
      identifier: 'login5@example.com',
      password: 'CorrectPass5!',
    })
    expect(result.requires2FA).toBe(true)
    expect(result.twoFactorMethod).toBe('TOTP')
    expect(result.challengeId).toBeUndefined()
  })

  it('returns requires2FA=true with method=SMS + challengeId when SMS 2FA is enabled', async () => {
    const user = await createVerifiedUser('login-sms@example.com', 'CorrectPassSms1!', 'LoginTest SMS')
    // Attach a verified phone for the SMS 2FA path
    await prisma.userIdentifier.create({
      data: {
        userId: user.id,
        type: 'PHONE',
        identifier: `+6140000${Date.now().toString().slice(-4)}`,
        verified: true,
        verifiedAt: new Date(),
      },
    })
    await prisma.user.update({
      where: { id: user.id },
      data: {
        twoFactorMethod: 'SMS',
        twoFactorEnabledAt: new Date(),
      },
    })
    const result = await loginUser({
      identifier: 'login-sms@example.com',
      password: 'CorrectPassSms1!',
    })
    expect(result.requires2FA).toBe(true)
    expect(result.twoFactorMethod).toBe('SMS')
    expect(result.challengeId).toBeDefined()
    expect(typeof result.challengeId).toBe('string')
  })

  it('throws on unknown identifier', async () => {
    await expect(
      loginUser({ identifier: 'ghost@example.com', password: 'nope' })
    ).rejects.toThrow('Invalid credentials')
  })
})
