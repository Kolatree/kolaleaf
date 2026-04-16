import { Resend } from 'resend'

/**
 * Resend client initialization.
 *
 * Production: RESEND_API_KEY and EMAIL_FROM are both required; missing either
 * throws the first time `getResend()` is called (or `sendEmail()`, which
 * calls it). The check is LAZY (first-use, not module-load) so `next build`
 * can evaluate route modules without throwing before env vars are wired on
 * the host — the server still refuses to send email with missing creds at
 * runtime.
 *
 * Dev/test: both may be omitted. `getResend()` returns null and `sendEmail()`
 * falls back to `console.log` with a `[email-dev]` prefix so the local loop
 * stays frictionless and tests don't need network access.
 */

// Read once at module load (cheap, side-effect-free). The fail-fast THROW is
// deferred to assertResendConfig() on first-use.
const apiKey = process.env.RESEND_API_KEY
const emailFrom = process.env.EMAIL_FROM

export function assertResendConfig(): void {
  const isProduction = process.env.NODE_ENV === 'production'
  if (!isProduction) return
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error('RESEND_API_KEY is required in production')
  }
  if (!emailFrom || emailFrom.trim().length === 0) {
    throw new Error('EMAIL_FROM is required in production')
  }
}

let client: Resend | null = null

export function getResend(): Resend | null {
  assertResendConfig()
  if (client) return client
  if (!apiKey) return null
  client = new Resend(apiKey)
  return client
}

export function getEmailFrom(): string {
  return emailFrom ?? 'Kolaleaf <noreply@kolaleaf.local>'
}

export function hasApiKey(): boolean {
  return Boolean(apiKey && apiKey.trim().length > 0)
}
