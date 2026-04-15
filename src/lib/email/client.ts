import { Resend } from 'resend'

/**
 * Resend client initialization.
 *
 * Production: RESEND_API_KEY and EMAIL_FROM are both required; missing either
 * is a startup failure — we would rather the deploy go red than silently fail
 * to send verification emails to real users.
 *
 * Dev/test: both may be omitted. `getResend()` returns null and `sendEmail()`
 * falls back to `console.log` with a `[email-dev]` prefix so the local loop
 * stays frictionless and tests don't need network access.
 */

const apiKey = process.env.RESEND_API_KEY
const emailFrom = process.env.EMAIL_FROM
const isProduction = process.env.NODE_ENV === 'production'

if (isProduction) {
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error('RESEND_API_KEY is required in production')
  }
  if (!emailFrom || emailFrom.trim().length === 0) {
    throw new Error('EMAIL_FROM is required in production')
  }
}

let client: Resend | null = null

export function getResend(): Resend | null {
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
