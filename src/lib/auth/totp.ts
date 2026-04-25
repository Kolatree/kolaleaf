import crypto from 'crypto'
import bcrypt from 'bcrypt'
import { generateSecret, generateURI, verifySync } from 'otplib'
import QRCode from 'qrcode'
import { prisma } from '@/lib/db/client'

const ISSUER = 'Kolaleaf'

// Match the SMS-code pattern: bcrypt cost 4. Backup codes are 10 random
// alphanumeric chars (~52 bits entropy) — rainbow-tables aren't a concern, but
// we still want salted hashing so an attacker who reads one user's hashes
// can't cross-match them against another's. Cost 4 keeps verify fast.
const BACKUP_CODE_BCRYPT_COST = 4
const BACKUP_CODE_COUNT_DEFAULT = 8
const BACKUP_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // omit 0/O/1/I for legibility

/**
 * Generate a fresh base32 TOTP secret.
 *
 * Delegates to otplib so it matches whatever the canonical secret shape for
 * the `verifySync` call path is. Returns just the secret — the otpauth URI
 * is built separately so callers can decide the label/issuer.
 */
export function generateTotpSecret(): string {
  return generateSecret()
}

/**
 * Build the `otpauth://totp/...` URI consumed by authenticator apps.
 *
 * The `accountLabel` shows up as the account name in the user's app — we use
 * the primary email so multiple Kolaleaf accounts on one device are
 * distinguishable. Issuer is a constant.
 */
export function buildOtpauthUri(params: {
  secret: string
  accountLabel: string
  issuer?: string
}): string {
  return generateURI({
    issuer: params.issuer ?? ISSUER,
    label: params.accountLabel,
    secret: params.secret,
  })
}

/**
 * Render an otpauth URI as an inline PNG data URL. The result is safe to
 * embed directly in an <img src> on the /account page.
 */
export async function generateQrCodeDataUrl(otpauthUri: string): Promise<string> {
  return QRCode.toDataURL(otpauthUri, { margin: 1, width: 240 })
}

/**
 * Verify a 6-digit TOTP code against a secret, tolerating ±1 time step
 * (~30s each side) for clock drift. Matches the standard server-side window
 * most TOTP implementations use.
 *
 * Pure cryptographic check — no replay protection. Used by enable route
 * (validating a newly-scanned secret) and as the inner check for
 * `verifyTotpCodeWithReplay`.
 */
export function verifyTotpCode(secret: string, code: string): boolean {
  if (!secret || !code) return false
  // epochTolerance is in seconds (not steps); 30s = ±1 time step
  const STEP_SECONDS = 30
  const result = verifySync({ token: code, secret, epochTolerance: STEP_SECONDS })
  return result.valid
}

/**
 * Verify a TOTP code with replay protection. Runs the cryptographic check
 * first, then atomically advances `twoFactorLastUsedStep` via a conditional
 * UPDATE that only succeeds if the stored step is older than the current one.
 * This eliminates the TOCTOU race between read and write — concurrent requests
 * carrying the same code will have at most one succeed.
 */
export async function verifyTotpCodeWithReplay(
  secret: string,
  code: string,
  userId: string,
): Promise<boolean> {
  if (!verifyTotpCode(secret, code)) return false

  const currentStep = BigInt(Math.floor(Date.now() / 30_000))

  // Atomic conditional UPDATE: only advances the step if the current stored
  // value is NULL (first use) or strictly less than currentStep. If another
  // concurrent request already advanced it, this returns 0 rows affected
  // and we reject the replay.
  const affected: number = await prisma.$executeRaw`
    UPDATE "User"
    SET "twoFactorLastUsedStep" = ${currentStep}
    WHERE id = ${userId}
      AND ("twoFactorLastUsedStep" IS NULL OR "twoFactorLastUsedStep" < ${currentStep})
  `

  return affected > 0
}

/**
 * Generate `count` backup codes in `XXXX-XXXXXX` format (10 alphanumeric
 * chars + a visual separator) plus their bcrypt hashes. The raw codes are
 * shown to the user ONCE on enable; only the hashes ever touch the DB.
 */
export function generateBackupCodes(count: number = BACKUP_CODE_COUNT_DEFAULT): {
  codes: string[]
  hashes: string[]
} {
  const codes: string[] = []
  const hashes: string[] = []
  const seen = new Set<string>()

  while (codes.length < count) {
    const raw = randomAlphanumeric(10)
    const formatted = `${raw.slice(0, 4)}-${raw.slice(4)}`
    if (seen.has(formatted)) continue
    seen.add(formatted)
    codes.push(formatted)
    hashes.push(bcrypt.hashSync(formatted, BACKUP_CODE_BCRYPT_COST))
  }

  return { codes, hashes }
}

/**
 * Try to match a raw backup code against a list of stored hashes. On a
 * successful match the used hash is removed from the returned
 * `remainingHashes` array so the caller can persist the reduced list — each
 * backup code is single-use.
 *
 * Comparison is case-insensitive on the input (codes are stored formatted
 * and users may type them in any case). Missing separator is tolerated.
 */
export async function verifyBackupCode(
  rawCode: string,
  storedHashes: string[],
): Promise<{ valid: boolean; remainingHashes: string[] }> {
  if (!rawCode || !Array.isArray(storedHashes) || storedHashes.length === 0) {
    return { valid: false, remainingHashes: storedHashes ?? [] }
  }

  const candidate = normaliseBackupCode(rawCode)
  if (!candidate) {
    return { valid: false, remainingHashes: storedHashes }
  }

  for (let i = 0; i < storedHashes.length; i++) {
    const hash = storedHashes[i]
    // eslint-disable-next-line no-await-in-loop -- sequential compare is fine; list is tiny (8)
    const ok = await bcrypt.compare(candidate, hash)
    if (ok) {
      const remaining = storedHashes.slice()
      remaining.splice(i, 1)
      return { valid: true, remainingHashes: remaining }
    }
  }

  return { valid: false, remainingHashes: storedHashes }
}

function randomAlphanumeric(length: number): string {
  const out: string[] = []
  for (let i = 0; i < length; i++) {
    const idx = crypto.randomInt(0, BACKUP_CODE_ALPHABET.length)
    out.push(BACKUP_CODE_ALPHABET[idx])
  }
  return out.join('')
}

function normaliseBackupCode(raw: string): string | null {
  const stripped = raw.replace(/\s+/g, '').toUpperCase()
  if (stripped.length === 10) {
    return `${stripped.slice(0, 4)}-${stripped.slice(4)}`
  }
  if (stripped.length === 11 && stripped[4] === '-') {
    return stripped
  }
  return null
}
