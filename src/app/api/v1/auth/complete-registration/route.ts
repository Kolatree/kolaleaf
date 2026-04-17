import { NextResponse } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/db/client'
import {
  hashPassword,
  validatePasswordComplexity,
  verifyPassword,
} from '@/lib/auth/password'
import { setSessionCookie } from '@/lib/auth/middleware'
import { buildSessionData } from '@/lib/auth/sessions'
import { logAuthEvent, logAuthEventsMany } from '@/lib/auth/audit'
import type { CompleteRegistrationReason } from '@/lib/auth/reasons'
import { getClientIp } from '@/lib/http/ip'
import { jsonError } from '@/lib/http/json-error'
import { parseBody } from '@/lib/http/validate'
import { CompleteRegistrationBody } from './_schemas'

// POST /api/v1/auth/complete-registration
//
// Step 3 — and the only step that writes to User. The caller must have
// previously completed /send-code and /verify-code; that leaves a
// PendingEmailVerification row with verifiedAt set and claimExpiresAt
// still in the future. This endpoint consumes that claim to create the
// User, the verified UserIdentifier, and the Session, and deletes the
// pending row — all in one transaction.
//
// Shape-level validation (email format, field lengths, AU_STATE /
// postcode regex) lives in _schemas.ts. Business-logic validation
// (NFKC normalisation, password complexity, letter-required name
// guard, idempotent-retry password match) stays here because it can't
// be expressed cleanly in a Zod rule.
const HAS_LETTER_RE = /\p{L}/u
const TX_TIMEOUT_MS = 15_000
const TX_MAX_WAIT_MS = 5_000

type Reason = CompleteRegistrationReason

function fail(reason: Reason, message: string, status: number) {
  return jsonError(reason, message, status)
}

export async function POST(request: Request) {
  const parsed = await parseBody(request, CompleteRegistrationBody)
  if (!parsed.ok) return parsed.response
  const {
    email,
    fullName: rawFullName,
    password,
    addressLine1,
    addressLine2: rawLine2,
    city,
    state,
    postcode,
  } = parsed.data

  // Password complexity (character-class mix) isn't length-only and
  // isn't captured by the Zod schema — keep the existing helper.
  const pwCheck = validatePasswordComplexity(password)
  if (!pwCheck.ok) {
    return fail('weak_password', pwCheck.error, 400)
  }

  // Unicode NFKC + letter-required guard. Rejects zero-width-only
  // names that satisfy .trim().length but render empty — those would
  // corrupt the AUSTRAC audit trail's legal-name column.
  const fullNameNormalized = rawFullName
    .normalize('NFKC')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
    .trim()
  if (fullNameNormalized.length < 2 || !HAS_LETTER_RE.test(fullNameNormalized)) {
    return fail('name_letters_required', 'Full name must contain at least one letter', 400)
  }

  const fullName = fullNameNormalized
  const addressLine2 = rawLine2 && rawLine2.length > 0 ? rawLine2 : null
  const ip = getClientIp(request)
  const userAgent = request.headers.get('user-agent') ?? undefined

  // Idempotent-retry short-circuit. If the client re-posts after a
  // successful-but-dropped response, the tx already deleted the pending
  // row — the old path would return 400 telling the user to verify
  // again, which strands them. Instead: if a verified EMAIL identifier
  // already exists for this email AND the submitted password matches
  // the stored hash, treat this as a retry of the just-succeeded call.
  // Mismatched password → 409. Hash is computed LATER so we don't burn
  // bcrypt time on the retry path.
  const maybeExisting = await prisma.userIdentifier.findUnique({
    where: { identifier: email },
    include: { user: true },
  })
  if (maybeExisting && maybeExisting.type === 'EMAIL' && maybeExisting.verified) {
    const u = maybeExisting.user
    if (!u.passwordHash || !(await verifyPassword(pwCheck.password, u.passwordHash))) {
      return fail('already_registered', 'Email already registered', 409)
    }
    const session = await prisma.session.create({
      data: buildSessionData(u.id, ip, userAgent),
    })
    await logAuthEvent({
      userId: u.id,
      event: 'LOGIN',
      ip,
      metadata: { via: 'complete-registration-retry' },
    })
    const response = NextResponse.json(
      { user: { id: u.id, fullName: u.fullName } },
      { status: 201 },
    )
    response.headers.set('Set-Cookie', setSessionCookie(session.token))
    return response
  }

  // Only hash once we know we're creating a new user (bcrypt is ~300ms
  // at cost 12 — no reason to burn it on the retry/409 paths above).
  const passwordHash = await hashPassword(pwCheck.password)

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const pending = await tx.pendingEmailVerification.findUnique({ where: { email } })
        if (!pending) {
          throw new CompleteError('no_pending_verification', 400, 'Verify your email to continue')
        }
        if (!pending.verifiedAt) {
          throw new CompleteError('pending_not_verified', 400, 'Please verify your email first')
        }
        // Boundary: claim is valid iff now < claimExpiresAt.
        if (!pending.claimExpiresAt || pending.claimExpiresAt <= new Date()) {
          throw new CompleteError(
            'claim_expired',
            400,
            'Your verification expired. Please start again.',
          )
        }

        // Race guard + OAuth protection + active-session protection.
        const existing = await tx.userIdentifier.findUnique({
          where: { identifier: email },
          include: { user: { select: { _count: { select: { sessions: true, transfers: true } } } } },
        })
        if (existing && (existing.type !== 'EMAIL' || existing.verified)) {
          throw new CompleteError('already_registered', 409, 'Email already registered')
        }
        if (existing) {
          const legacyActivity =
            existing.user._count.sessions + existing.user._count.transfers
          if (legacyActivity > 0) {
            throw new CompleteError('already_registered', 409, 'Email already registered')
          }
        }

        const user = await tx.user.create({
          data: {
            fullName,
            passwordHash,
            addressLine1,
            addressLine2,
            city,
            state,
            postcode,
            country: 'AU',
          },
        })

        // Clean up the stale UNVERIFIED EMAIL identifier (if any) so
        // the new row's unique constraint can land. deleteMany is a
        // no-op on missing rows, avoiding P2025 under concurrent
        // cleanup.
        if (existing && existing.type === 'EMAIL' && !existing.verified) {
          await tx.userIdentifier.deleteMany({ where: { id: existing.id } })
        }
        await tx.userIdentifier.create({
          data: {
            userId: user.id,
            type: 'EMAIL',
            identifier: email,
            verified: true,
            verifiedAt: new Date(),
          },
        })

        const session = await tx.session.create({
          data: buildSessionData(user.id, ip, userAgent),
        })

        await tx.pendingEmailVerification.delete({ where: { email } })

        // Batch REGISTER + LOGIN into a single createMany round-trip,
        // shrinking the tx's lock window.
        await logAuthEventsMany(
          [
            { userId: user.id, event: 'REGISTER', ip, metadata: { via: 'verify-first' } },
            { userId: user.id, event: 'LOGIN', ip, metadata: { via: 'email-verification' } },
          ],
          tx,
        )

        return { user, session }
      },
      { timeout: TX_TIMEOUT_MS, maxWait: TX_MAX_WAIT_MS },
    )

    const response = NextResponse.json(
      { user: { id: result.user.id, fullName: result.user.fullName } },
      { status: 201 },
    )
    response.headers.set('Set-Cookie', setSessionCookie(result.session.token))
    return response
  } catch (err) {
    if (err instanceof CompleteError) {
      return fail(err.reason, err.message, err.statusCode)
    }
    // P2002 — unique-constraint violation. Under concurrent requests
    // one tx wins and the other hits P2002 on UserIdentifier.identifier
    // — that's a 409, not a 500.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      return fail('already_registered', 'Email already registered', 409)
    }
    console.error(
      JSON.stringify({
        level: 'error',
        route: 'auth/complete-registration',
        reason: 'unexpected',
        error: err instanceof Error ? err.message : String(err),
        ts: new Date().toISOString(),
      }),
    )
    return fail('unexpected', 'Registration failed', 500)
  }
}

class CompleteError extends Error {
  public readonly statusCode: number
  public readonly reason: Reason

  constructor(reason: Reason, statusCode: number, message: string) {
    super(message)
    this.name = 'CompleteError'
    this.reason = reason
    this.statusCode = statusCode
  }
}
