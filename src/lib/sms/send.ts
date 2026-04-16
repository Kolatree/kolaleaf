import { assertTwilioConfig, getTwilio, getFromNumber, hasTwilioConfig } from './client'

export interface SendSmsParams {
  to: string
  body: string
}

export interface SendSmsResult {
  ok: boolean
  id?: string
  error?: string
}

/**
 * Send an SMS via Twilio.
 *
 * In dev/test (no TWILIO_* env) we log the destination + body to stdout with a
 * `[sms-dev]` prefix so the local loop can grab the 6-digit code from the
 * terminal. In production that branch is unreachable because `client.ts`
 * throws at import-time when any of the three env vars is missing.
 *
 * Must NOT throw: the caller is responsible for logging or recording failures
 * — an SMS send error must not blow up the surrounding transaction (e.g.
 * generating a code row should succeed even if Twilio is temporarily down;
 * the user can retry via the re-send flow).
 */
export async function sendSms(params: SendSmsParams): Promise<SendSmsResult> {
  const { to, body } = params

  // Fail-fast in production BEFORE falling through to the dev log branch —
  // a missing Twilio env in prod must raise, not silently log the code.
  assertTwilioConfig()

  if (!hasTwilioConfig()) {
    // Dev fallback. Never reachable in production (client.ts throws).
    // We deliberately DO log the raw code in dev — it's the whole point of the
    // fallback. Do not replicate this pattern in production paths.
    console.log('[sms-dev] ──────────────────────────────────────')
    console.log('[sms-dev] To:  ', to)
    console.log('[sms-dev] Body:', body)
    console.log('[sms-dev] ──────────────────────────────────────')
    return { ok: true, id: 'dev-mode' }
  }

  const twilio = getTwilio()
  if (!twilio) {
    return { ok: false, error: 'Twilio client not initialized' }
  }

  try {
    const message = await twilio.messages.create({
      to,
      from: getFromNumber(),
      body,
    })
    return { ok: true, id: message.sid }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'SMS send failed'
    console.error('[sms] send threw:', err)
    return { ok: false, error: message }
  }
}
