import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/db/client'
import { hashPassword, validatePasswordComplexity } from '@/lib/auth/password'
import { setSessionCookie } from '@/lib/auth/middleware'
import { SESSION_EXPIRY_MINUTES } from '@/lib/auth/sessions'

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
// Validation model is intentionally strict and AU-only for v1:
//   - `state` must be one of NSW|VIC|QLD|WA|SA|TAS|ACT|NT
//   - `postcode` must be 4 digits (validated at the endpoint; the column
//     itself is nullable so the pre-wizard test users stay migration-safe)
//   - `country` is always written as "AU" — not accepted from the client.
const AU_STATES = new Set(['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'])
const POSTCODE_RE = /^\d{4}$/

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
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
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
    return NextResponse.json({ error: 'Email is required' }, { status: 400 })
  }
  if (!rawFullName || typeof rawFullName !== 'string' || rawFullName.trim().length < 2) {
    return NextResponse.json({ error: 'Full name is required' }, { status: 400 })
  }
  const pwCheck = validatePasswordComplexity(password)
  if (!pwCheck.ok) {
    return NextResponse.json({ error: pwCheck.error }, { status: 400 })
  }
  if (!rawLine1 || typeof rawLine1 !== 'string' || rawLine1.trim().length < 3) {
    return NextResponse.json({ error: 'Address line 1 is required' }, { status: 400 })
  }
  if (rawLine2 !== undefined && typeof rawLine2 !== 'string') {
    return NextResponse.json({ error: 'Address line 2 is invalid' }, { status: 400 })
  }
  if (!rawCity || typeof rawCity !== 'string' || rawCity.trim().length === 0) {
    return NextResponse.json({ error: 'City is required' }, { status: 400 })
  }
  if (!rawState || typeof rawState !== 'string' || !AU_STATES.has(rawState)) {
    return NextResponse.json({ error: 'State must be one of NSW, VIC, QLD, WA, SA, TAS, ACT, NT' }, { status: 400 })
  }
  if (!rawPostcode || typeof rawPostcode !== 'string' || !POSTCODE_RE.test(rawPostcode)) {
    return NextResponse.json({ error: 'Postcode must be 4 digits' }, { status: 400 })
  }

  const email = rawEmail.trim().toLowerCase()
  const fullName = rawFullName.trim()
  const addressLine1 = rawLine1.trim()
  const addressLine2 = rawLine2 && rawLine2.trim().length > 0 ? rawLine2.trim() : null
  const city = rawCity.trim()
  const state = rawState
  const postcode = rawPostcode
  const ip = request.headers.get('x-forwarded-for') ?? undefined
  const userAgent = request.headers.get('user-agent') ?? undefined

  const passwordHash = await hashPassword(pwCheck.password)

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. The pending claim must exist, be verified, and inside the window.
      const pending = await tx.pendingEmailVerification.findUnique({ where: { email } })
      if (!pending) {
        throw new CompleteError(400, 'Verify your email to continue')
      }
      if (!pending.verifiedAt) {
        throw new CompleteError(400, 'Please verify your email first')
      }
      if (!pending.claimExpiresAt || pending.claimExpiresAt < new Date()) {
        throw new CompleteError(400, 'Your verification expired. Please start again.')
      }

      // 2. Race guard — if the identifier already exists, reject with 409.
      //    We treat BOTH verified-email and non-EMAIL (PHONE/GOOGLE/APPLE)
      //    collisions as 409: a non-EMAIL row happens to share the string
      //    (future OAuth flows may use an email-shaped sub claim), and we
      //    must not silently delete it. Only a stale UNVERIFIED EMAIL row
      //    is safe to clean up below.
      const existing = await tx.userIdentifier.findUnique({ where: { identifier: email } })
      if (existing && (existing.type !== 'EMAIL' || existing.verified)) {
        throw new CompleteError(409, 'Email already registered')
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

      // 4. Create the verified UserIdentifier. We cannot rely on the User
      //    nested-create path here because we also need to cope with a
      //    stale UNVERIFIED EMAIL row for the same address (the `existing`
      //    guard above lets that case through — we clean it up so the new
      //    row's unique constraint can land). The type check is redundant
      //    with the 409 above but explicit so future edits can't drop the
      //    guard without noticing.
      if (existing && existing.type === 'EMAIL' && !existing.verified) {
        await tx.userIdentifier.delete({ where: { id: existing.id } })
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

      // 5. Session + cookie. Callback-mode transaction so the insert sees
      //    the newly-created User row before we set the FK.
      const token = crypto.randomBytes(32).toString('hex')
      const expiresAt = new Date(Date.now() + SESSION_EXPIRY_MINUTES * 60 * 1000)
      const session = await tx.session.create({
        data: { userId: user.id, token, expiresAt, ip: ip ?? null, userAgent: userAgent ?? null },
      })

      // 6. Delete the pending row so a duplicate POST can't re-create the
      //    account. Keyed by email (unique).
      await tx.pendingEmailVerification.delete({ where: { email } })

      // 7. Audit events — REGISTER (account created) and LOGIN (the
      //    session issued at the same time). `REGISTER` matches the string
      //    the pre-wizard service layer wrote, so AUSTRAC audit queries
      //    filtering on that value find every account regardless of
      //    whether it came through the old path or this one.
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
    })

    const response = NextResponse.json(
      { user: { id: result.user.id, fullName: result.user.fullName } },
      { status: 201 },
    )
    response.headers.set('Set-Cookie', setSessionCookie(result.session.token))
    return response
  } catch (err) {
    if (err instanceof CompleteError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode })
    }
    console.error('[auth/complete-registration]', err)
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 })
  }
}

class CompleteError extends Error {
  public readonly statusCode: number
  constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'CompleteError'
    this.statusCode = statusCode
  }
}
