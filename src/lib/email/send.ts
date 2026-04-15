import { getResend, getEmailFrom, hasApiKey } from './client'

export interface SendEmailParams {
  to: string
  subject: string
  html: string
  text: string
}

export interface SendEmailResult {
  ok: boolean
  id?: string
  error?: string
}

/**
 * Send an email via Resend.
 *
 * In dev/test (no RESEND_API_KEY) we log the full email payload to stdout with
 * a `[email-dev]` prefix — useful for grabbing a reset link from the terminal
 * without running a real SMTP round-trip. In production this path is unreachable
 * because `client.ts` throws at import-time when the key is missing.
 */
export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const { to, subject, html, text } = params

  if (!hasApiKey()) {
    console.log('[email-dev] ──────────────────────────────────────')
    console.log('[email-dev] To:      ', to)
    console.log('[email-dev] From:    ', getEmailFrom())
    console.log('[email-dev] Subject: ', subject)
    console.log('[email-dev] Text:')
    console.log(text)
    console.log('[email-dev] ──────────────────────────────────────')
    return { ok: true, id: 'dev-mode' }
  }

  const resend = getResend()
  if (!resend) {
    return { ok: false, error: 'Resend client not initialized' }
  }

  try {
    const result = await resend.emails.send({
      from: getEmailFrom(),
      to,
      subject,
      html,
      text,
    })

    // Resend v4 returns { data, error }
    const data = (result as { data?: { id?: string } | null }).data
    const error = (result as { error?: { message?: string } | null }).error

    if (error) {
      console.error('[email] Resend returned error:', error)
      return { ok: false, error: error.message ?? 'Unknown Resend error' }
    }

    return { ok: true, id: data?.id }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Email send failed'
    console.error('[email] send threw:', err)
    return { ok: false, error: message }
  }
}
