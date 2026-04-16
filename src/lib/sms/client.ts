import Twilio from 'twilio'

/**
 * Twilio client initialization.
 *
 * Production: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER
 * are all required; missing any throws the first time `getTwilio()` is called
 * (or `sendSms()`, which calls it). The check is LAZY (first-use, not
 * module-load) so `next build` can evaluate route modules without throwing
 * before env vars are wired on the host — the server still refuses to send
 * SMS with missing creds at runtime. AML + authentication still fail-fast.
 *
 * Dev/test: all three may be omitted. `getTwilio()` returns null and
 * `sendSms()` falls back to `console.log` with a `[sms-dev]` prefix so the
 * local loop stays frictionless and tests don't need network access.
 *
 * Pattern mirrors src/lib/email/client.ts on purpose — same behavior contract.
 */

// Read once at module load (cheap, side-effect-free). The fail-fast THROW is
// deferred to assertTwilioConfig() on first-use.
const accountSid = process.env.TWILIO_ACCOUNT_SID
const authToken = process.env.TWILIO_AUTH_TOKEN
const fromNumber = process.env.TWILIO_FROM_NUMBER

export function assertTwilioConfig(): void {
  const isProduction = process.env.NODE_ENV === 'production'
  if (!isProduction) return
  if (!accountSid || accountSid.trim().length === 0) {
    throw new Error('TWILIO_ACCOUNT_SID is required in production')
  }
  if (!authToken || authToken.trim().length === 0) {
    throw new Error('TWILIO_AUTH_TOKEN is required in production')
  }
  if (!fromNumber || fromNumber.trim().length === 0) {
    throw new Error('TWILIO_FROM_NUMBER is required in production')
  }
}

type TwilioClient = ReturnType<typeof Twilio>

let client: TwilioClient | null = null

export function getTwilio(): TwilioClient | null {
  assertTwilioConfig()
  if (client) return client
  if (!accountSid || !authToken) return null
  client = Twilio(accountSid, authToken)
  return client
}

export function getFromNumber(): string {
  return fromNumber ?? ''
}

export function hasTwilioConfig(): boolean {
  return Boolean(
    accountSid && accountSid.trim().length > 0 &&
    authToken && authToken.trim().length > 0 &&
    fromNumber && fromNumber.trim().length > 0,
  )
}
