import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/db/client'
import {
  hashPassword,
  validatePasswordComplexity,
  verifyPassword,
} from '@/lib/auth/password'
import { setSessionCookie } from '@/lib/auth/middleware'
import { SESSION_EXPIRY_MINUTES } from '@/lib/auth/sessions'
import { getClientIp } from '@/lib/http/ip'

// POST /api/auth/complete-registration
//
// Body: {
//   email, fullName, password,
//   addressLine1, addressLine2?, city, state, postcode
// }
//
// Step 3 — and the only step that writes to `User`. The caller must have
// previously completed /send-code and /verify-code; that leaves a
// PendingEmailVerification row with `verifiedAt` set and
// `claimExpiresAt > now`. This endpoint consumes that claim to create the
// User, the verified UserIdentifier, and the Session, and deletes the
// pending row — all in one transaction. A failure at any step rolls
// everything back and leaves the claim window intact for a retry.
//
// Error responses always carry both a user-facing `error` string and a
// stable machine-readable `reason` enum, so clients can route by reason
// instead of string-matching copy.
//
// Validation model is intentionally strict and AU-only for v1:
//   - `state` must be one of NSW|VIC|QLD|WA|SA|TAS|ACT|NT (case-insensitive)
//   - `postcode` must be 4 digits (trimmed before test)
//   - `country` is always written as "AU" — not accepted from the client.
//   - `fullName` is Unicode-normalized (NFKC) and must contain at least
//     one letter character. Zero-width whitespace alone is rejected.

const AU_STATES = new Set(['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'])
const POSTCODE_RE = /^\d{4}$/
const HAS_LETTER_RE = /\p{L}/u

// Upper bounds on every free-text field. bcrypt ignores bytes past 72 so
// 128 is more than enough for any realistic password; address lines and
// fullName at 200 chars match what Sumsub's KYC upload tolerates for
// legal names.
const MAX_LENGTHS = {
  fullName: 200,
  addressLine1: 200,
  addressLine2: 200,
  city: 100,
  password: 128,
} as const

// Prisma interactive transactions default to timeout: 5000ms. Our tx
// does 7 writes across User, UserIdentifier, Session, AuthEvent (x2),
// PendingEmailVerification delete. On a cold Railway Postgres that can
// push p99 past 5s. 15s leaves headroom; a tx longer than 15s is a
// genuine outage signal worth failing.
const TX_TIMEOUT_MS = 15_000
const TX_MAX_WAIT_MS = 5_000

type Reason =
  | 'invalid_json'
  | 'missing_email'
  | 'missing_name'
  | 'weak_password'
  | 'missing_address_line1'
  | 'invalid_address_line2'
  | 'missing_city'
  | 'invalid_state'
  | 'invalid_postcode'
  | 'field_too_long'
  | 'name_letters_required'
  | 'no_pending_verification'
  | 'pending_not_verified'
  | 'claim_expired'
  | 'already_registered'
  | 'unexpected'

function failure(reason: Reason, message: string, status: number): NextResponse {
  return NextResponse.json({ error: message, reason }, { status })
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
    return failure('invalid_json', 'Invalid JSON', 400)
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

  // Shape + presence checks.
  if (!rawEmail || typeof rawEmail !== 'string' || !rawEmail.includes('@')) {
    return failure('missing_email', 'Email is required', 400)
  }
  if (!rawFullName || typeof rawFullName !== 'string' || rawFullName.trim().length < 2) {
    return failure('missing_name', 'Full name is required', 400)
  }
  const pwCheck = validatePasswordComplexity(password)
  if (!pwCheck.ok) {
    return failure('weak_password', pwCheck.error, 400)
  }
  if (!rawLine1 || typeof rawLine1 !== 'string' || rawLine1.trim().length < 3) {
    return failure('missing_address_line1', 'Address line 1 is required', 400)
  }
  if (rawLine2 !== undefined && typeof rawLine2 !== 'string') {
    return failure('invalid_address_line2', 'Address line 2 is invalid', 400)
  }
  if (!rawCity || typeof rawCity !== 'string' || rawCity.trim().length === 0) {
    return failure('missing_city', 'City is required', 400)
  }
  if (!rawState || typeof rawState !== 'string' || !AU_STATES.has(rawState.trim().toUpperCase())) {
    return failure(
      'invalid_state',
      'State must be one of NSW, VIC, QLD, WA, SA, TAS, ACT, NT',
      400,
    )
  }
  const trimmedPostcode = rawPostcode?.toString().trim() ?? ''
  if (!POSTCODE_RE.test(trimmedPostcode)) {
    return failure('invalid_postcode', 'Postcode must be 4 digits', 400)
  }

  // Upper-bound checks. bcrypt + Prisma TEXT accept anything; we don't.
  if (
    rawFullName.length > MAX_LENGTHS.fullName ||
    rawLine1.length > MAX_LENGTHS.addressLine1 ||
    (rawLine2?.length ?? 0) > MAX_LENGTHS.addressLine2 ||
    rawCity.length > MAX_LENGTHS.city ||
    pwCheck.password.length > MAX_LENGTHS.password
  ) {
    return failure('field_too_long', 'One or more fields exceed the allowed length', 400)
  }

  // Unicode normalization for name. NFKC collapses half/full-width and
  // compatibility forms. Strip zero-width and BOM-class characters (they
  // satisfy JavaScript `.trim()` min-length but render as empty). Then
  // require at least one actual letter — zero-width-only strings and
  // pure-numeric strings are rejected as clearly-not-a-legal-name.
  const fullNameNormalized = rawFullName
    .normalize('NFKC')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
    .trim()
  if (fullNameNormalized.length < 2 || !HAS_LETTER_RE.test(fullNameNormalized)) {
    return failure(
      'name_letters_required',
      'Full name must contain at least one letter',
      400,
    )
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
  const passwordHash = await hashPassword(pwCheck.password)

  // Idempotent-retry short-circuit. If the client re-posts after a
  // successful-but-dropped response (flaky mobile network), the tx has
  // already deleted the pending row and the old path would return 400
  // telling the user to verify again — leaving them stranded. Instead:
  // if a verified EMAIL identifier already exists for this email AND
  // the submitted password matches the stored hash, treat this as a
  // retry of the just-succeeded call. Issue a fresh session, return 201.
  // Mismatched password → 409; it's not a retry, it's someone else
  // trying to register over a real account.
  const maybeExisting = await prisma.userIdentifier.findUnique({
    where: { identifier: email },
    include: { user: true },
  })
  if (maybeExisting && maybeExisting.type === 'EMAIL' && maybeExisting.verified) {
    const u = maybeExisting.user
    if (!u.passwordHash || !(await verifyPassword(pwCheck.password, u.passwordHash))) {
      return failure('already_registered', 'Email already registered', 409)
    }
    const token = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + SESSION_EXPIRY_MINUTES * 60 * 1000)
    const session = await prisma.session.create({
      data: { userId: u.id, token, expiresAt, ip: ip ?? null, userAgent: userAgent ?? null },
    })
    await prisma.authEvent.create({
      data: {
        userId: u.id,
        event: 'LOGIN',
        ip: ip ?? null,
        metadata: { via: 'complete-registration-retry' },
      },
    })
    const response = NextResponse.json(
      { user: { id: u.id, fullName: u.fullName } },
      { status: 201 },
    )
    response.headers.set('Set-Cookie', setSessionCookie(session.token))
    return response
  }

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        // 1. The pending claim must exist, be verified, and inside the window.
        const pending = await tx.pendingEmailVerification.findUnique({ where: { email } })
        if (!pending) {
          throw new CompleteError('no_pending_verification', 400, 'Verify your email to continue')
        }
        if (!pending.verifiedAt) {
          throw new CompleteError('pending_not_verified', 400, 'Please verify your email first')
        }
        // Boundary convention: the claim is valid iff `now < claimExpiresAt`.
        // `<=` here means "now is at or past the boundary" → expired. This
        // matches verifyPendingEmailCode's `row.claimExpiresAt > now`.
        if (!pending.claimExpiresAt || pending.claimExpiresAt <= new Date()) {
          throw new CompleteError(
            'claim_expired',
            400,
            'Your verification expired. Please start again.',
          )
        }

        // 2. Race guard. Non-EMAIL (PHONE/GOOGLE/APPLE) collisions are
        //    treated as 409 and never deleted — a future OAuth flow may
        //    store an email-shaped string as `identifier` and we must
        //    not silently destroy it. Only a stale UNVERIFIED EMAIL row
        //    is safe to clean up, and only if no sessions or transfers
        //    reference its user (otherwise deleting it would strand a
        //    real account without an email identifier).
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
            // Legacy unverified-email user with active sessions or transfers.
            // Don't destroy their account silently — force them through a
            // normal login/recovery flow instead.
            throw new CompleteError('already_registered', 409, 'Email already registered')
          }
        }

        // 3. Create the User with all address fields + country=AU.
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

        // 4. Clean up a stale unverified EMAIL identifier (no activity,
        //    guarded above). `deleteMany` is a no-op on missing rows,
        //    avoiding P2025 if another request cleaned it up first.
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

        // 5. Session + cookie, inline because createSession uses the
        //    non-tx prisma client.
        const token = crypto.randomBytes(32).toString('hex')
        const expiresAt = new Date(Date.now() + SESSION_EXPIRY_MINUTES * 60 * 1000)
        const session = await tx.session.create({
          data: { userId: user.id, token, expiresAt, ip: ip ?? null, userAgent: userAgent ?? null },
        })

        // 6. Delete the pending row so a duplicate POST can't re-create the
        //    account. The retry short-circuit above handles the case where
        //    the client re-POSTs after this succeeds but the response was
        //    lost.
        await tx.pendingEmailVerification.delete({ where: { email } })

        // 7. Audit events — REGISTER + LOGIN. See preamble for naming rationale.
        await tx.authEvent.create({
          data: {
            userId: user.id,
            event: 'REGISTER',
            ip: ip ?? null,
            metadata: { via: 'verify-first' },
          },
        })
        await tx.authEvent.create({
          data: {
            userId: user.id,
            event: 'LOGIN',
            ip: ip ?? null,
            metadata: { via: 'email-verification' },
          },
        })

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
      return failure(err.reason, err.message, err.statusCode)
    }
    // P2002 is Prisma's unique-constraint violation. Under concurrent
    // /complete-registration for the same pending row, one tx wins and
    // the other hits P2002 on UserIdentifier.identifier — surface 409,
    // not a generic 500.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      return failure('already_registered', 'Email already registered', 409)
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
    return failure('unexpected', 'Registration failed', 500)
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
