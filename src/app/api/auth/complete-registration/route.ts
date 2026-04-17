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
import { AU_STATE_SET, AU_POSTCODE_RE } from '@/lib/auth/constants'
import type { CompleteRegistrationReason } from '@/lib/auth/reasons'
import { getClientIp } from '@/lib/http/ip'
import { jsonError } from '@/lib/http/json-error'

// POST /api/auth/complete-registration
//
// Step 3 — and the only step that writes to User. The caller must have
// previously completed /send-code and /verify-code; that leaves a
// PendingEmailVerification row with verifiedAt set and claimExpiresAt
// still in the future. This endpoint consumes that claim to create the
// User, the verified UserIdentifier, and the Session, and deletes the
// pending row — all in one transaction. Error responses always carry
// both a human-readable `error` and a stable machine-readable `reason`.
//
// Validation is AU-only for v1:
//   - state must be one of the AU_STATE_SET codes (case-insensitive)
//   - postcode must be 4 digits (trimmed before test)
//   - country is always written as "AU" — not accepted from the client
//   - fullName is NFKC-normalised and must contain at least one letter
const HAS_LETTER_RE = /\p{L}/u
const MAX_LENGTHS = {
  fullName: 200,
  addressLine1: 200,
  addressLine2: 200,
  city: 100,
  password: 128,
} as const
const TX_TIMEOUT_MS = 15_000
const TX_MAX_WAIT_MS = 5_000

type Reason = CompleteRegistrationReason

function fail(reason: Reason, message: string, status: number) {
  return jsonError(reason, message, status)
}

interface CompleteRegistrationBody {
  email?: string
  fullName?: string
  password?: string
  addressLine1?: string
  addressLine2?: string
  city?: string
  state?: string
  postcode?: string
}

export async function POST(request: Request) {
  let body: CompleteRegistrationBody
  try {
    body = await request.json()
  } catch {
    return fail('invalid_json', 'Invalid JSON', 400)
  }

  const {
    email: rawEmail,
    fullName: rawFullName,
    password,
    addressLine1: rawLine1,
    addressLine2: rawLine2,
    city: rawCity,
    state: rawState,
    postcode: rawPostcode,
  } = body

  if (!rawEmail || typeof rawEmail !== 'string' || !rawEmail.includes('@')) {
    return fail('missing_email', 'Email is required', 400)
  }
  if (!rawFullName || typeof rawFullName !== 'string' || rawFullName.trim().length < 2) {
    return fail('missing_name', 'Full name is required', 400)
  }
  const pwCheck = validatePasswordComplexity(password)
  if (!pwCheck.ok) {
    return fail('weak_password', pwCheck.error, 400)
  }
  if (!rawLine1 || typeof rawLine1 !== 'string' || rawLine1.trim().length < 3) {
    return fail('missing_address_line1', 'Address line 1 is required', 400)
  }
  if (rawLine2 !== undefined && typeof rawLine2 !== 'string') {
    return fail('invalid_address_line2', 'Address line 2 is invalid', 400)
  }
  if (!rawCity || typeof rawCity !== 'string' || rawCity.trim().length === 0) {
    return fail('missing_city', 'City is required', 400)
  }
  if (!rawState || typeof rawState !== 'string' || !AU_STATE_SET.has(rawState.trim().toUpperCase())) {
    return fail(
      'invalid_state',
      'State must be one of NSW, VIC, QLD, WA, SA, TAS, ACT, NT',
      400,
    )
  }
  const trimmedPostcode = rawPostcode?.toString().trim() ?? ''
  if (!AU_POSTCODE_RE.test(trimmedPostcode)) {
    return fail('invalid_postcode', 'Postcode must be 4 digits', 400)
  }

  if (
    rawFullName.length > MAX_LENGTHS.fullName ||
    rawLine1.length > MAX_LENGTHS.addressLine1 ||
    (rawLine2?.length ?? 0) > MAX_LENGTHS.addressLine2 ||
    rawCity.length > MAX_LENGTHS.city ||
    pwCheck.password.length > MAX_LENGTHS.password
  ) {
    return fail('field_too_long', 'One or more fields exceed the allowed length', 400)
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

  const email = rawEmail.trim().toLowerCase()
  const fullName = fullNameNormalized
  const addressLine1 = rawLine1.trim()
  const addressLine2 = rawLine2 && rawLine2.trim().length > 0 ? rawLine2.trim() : null
  const city = rawCity.trim()
  const state = rawState.trim().toUpperCase()
  const postcode = trimmedPostcode
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
