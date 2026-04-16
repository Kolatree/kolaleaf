/**
 * Kolaleaf — email verification template.
 *
 * Plain-text first; HTML is inline-styled for maximum email-client compat.
 * Colors nod to the purple→green brand gradient (fintech + Nigeria) without
 * requiring images or web fonts.
 */

export interface VerificationEmailParams {
  recipientName: string
  code: string
  expiresInMinutes: number
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

export function renderVerificationEmail(params: VerificationEmailParams): RenderedEmail {
  const { recipientName, code, expiresInMinutes } = params

  const subject = `Your Kolaleaf verification code: ${code}`

  const text = `Hi ${recipientName},

Welcome to Kolaleaf. Use the code below to verify your email and finish creating your account.

Verification code: ${code}

This code expires in ${expiresInMinutes} minutes. If you didn't request a Kolaleaf account, you can safely ignore this message.

— The Kolaleaf team`

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f6f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a2e;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f7fb;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
            <tr>
              <td style="padding:32px 40px;border-bottom:3px solid #6d4aff;background:linear-gradient(90deg,#6d4aff 0%,#1aa85a 100%);border-radius:12px 12px 0 0;">
                <div style="color:#ffffff;font-size:20px;font-weight:600;letter-spacing:-0.01em;">Kolaleaf</div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 40px;">
                <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:600;color:#1a1a2e;">Your verification code</h1>
                <p style="margin:0 0 16px 0;font-size:15px;line-height:1.55;color:#4a4a68;">Hi ${escapeHtml(recipientName)},</p>
                <p style="margin:0 0 24px 0;font-size:15px;line-height:1.55;color:#4a4a68;">Enter this code on the Kolaleaf verification screen to finish creating your account.</p>
                <div style="margin:0 0 24px 0;text-align:center;">
                  <div style="display:inline-block;font-family:'SF Mono','Menlo','Consolas',monospace;font-size:32px;font-weight:600;letter-spacing:0.35em;color:#1a1a2e;background:#f6f7fb;border:1px solid #eef0f5;border-radius:10px;padding:16px 24px 16px 30px;">${escapeHtml(code)}</div>
                </div>
                <p style="margin:0 0 8px 0;font-size:13px;line-height:1.5;color:#6a6a88;">This code expires in ${expiresInMinutes} minutes.</p>
                <p style="margin:0;font-size:13px;line-height:1.5;color:#6a6a88;">If you didn't request a Kolaleaf account, you can safely ignore this message.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 40px;border-top:1px solid #eef0f5;font-size:12px;color:#9a9ab0;text-align:center;">
                Kolaleaf — AUSTRAC-registered money transmitter
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

  return { subject, html, text }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttr(s: string): string {
  return escapeHtml(s)
}
