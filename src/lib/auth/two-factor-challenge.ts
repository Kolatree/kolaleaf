import { prisma } from '@/lib/db/client'
import { generateSmsCode, verifySmsCode } from './phone'
import { sendSms } from '@/lib/sms'

const CHALLENGE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const MAX_ATTEMPTS = 5

/**
 * Issue an SMS 2FA challenge for a user.
 *
 * Creates a `TwoFactorChallenge` row (method=SMS, 5-min expiry), sends the
 * 6-digit code to the user's phone, and returns the challenge id for the
 * caller to persist on their pending-login session. Raw code is never
 * returned to the caller or stored — only its bcrypt hash lives in DB.
 *
 * Consumed by login.ts in step 15f (not wired up in 15e).
 */
export async function issueSmsChallenge(
  userId: string,
  phoneE164: string,
): Promise<{ challengeId: string }> {
  const { code, hash } = generateSmsCode()
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS)

  const challenge = await prisma.twoFactorChallenge.create({
    data: {
      userId,
      method: 'SMS',
      codeHash: hash,
      expiresAt,
    },
  })

  await sendSms({
    to: phoneE164,
    body: `Your Kolaleaf verification code is ${code}. It expires in 5 minutes. If you didn't request this, ignore this message.`,
  })

  return { challengeId: challenge.id }
}

/**
 * Verify a raw code against an issued challenge.
 *
 * Enforces:
 * - challenge exists
 * - not expired
 * - not already consumed (no replay)
 * - attempts < 5 before the check
 *
 * On a correct code, marks `consumedAt`. On a wrong code, increments
 * `attempts`. Returns boolean — the route handler decides HTTP shape.
 */
export async function verifyChallenge(
  challengeId: string,
  rawCode: string,
): Promise<boolean> {
  const challenge = await prisma.twoFactorChallenge.findUnique({
    where: { id: challengeId },
  })

  if (!challenge) return false
  if (challenge.consumedAt) return false
  if (challenge.expiresAt < new Date()) return false
  if (challenge.attempts >= MAX_ATTEMPTS) return false
  if (!challenge.codeHash) return false

  // Always increment attempts — even a correct guess counts, so a brute-force
  // attacker can't just burn wrong guesses until the right one. When this
  // submission is the MAX_ATTEMPTS-th, also burn `consumedAt` so the
  // challenge is permanently dead (mirrors the /account/phone/verify route's
  // 5th-attempt behavior; without this a spent challenge lingers with
  // consumedAt=null until expiry).
  const willExhaust = challenge.attempts + 1 >= MAX_ATTEMPTS
  await prisma.twoFactorChallenge.update({
    where: { id: challengeId },
    data: willExhaust
      ? { attempts: { increment: 1 }, consumedAt: new Date() }
      : { attempts: { increment: 1 } },
  })

  const ok = await verifySmsCode(rawCode, challenge.codeHash)
  if (!ok) return false

  // If this correct submission was the exhausting attempt, consumedAt was
  // already stamped above. Only stamp here when it isn't already set.
  if (!willExhaust) {
    await prisma.twoFactorChallenge.update({
      where: { id: challengeId },
      data: { consumedAt: new Date() },
    })
  }
  return true
}
