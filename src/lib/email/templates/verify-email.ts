/**
 * Kolaleaf — email verification template.
 *
 * Plain-text first; HTML is inline-styled for maximum email-client compat.
 * Colors nod to the purple→green brand gradient (fintech + Nigeria) without
 * requiring images or web fonts.
 */

export interface VerificationEmailParams {
  recipientName: string
  verificationUrl: string
  expiresInHours: number
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

export function renderVerificationEmail(params: VerificationEmailParams): RenderedEmail {
  const { recipientName, verificationUrl, expiresInHours } = params

  const subject = 'Verify your Kolaleaf email'

  const text = `Hi ${recipientName},

Welcome to Kolaleaf. Please verify your email address to start sending money.

Verify here: ${verificationUrl}

This link expires in ${expiresInHours} hours. If you didn't create a Kolaleaf account, you can safely ignore this message.

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
                <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:600;color:#1a1a2e;">Verify your email</h1>
                <p style="margin:0 0 16px 0;font-size:15px;line-height:1.55;color:#4a4a68;">Hi ${escapeHtml(recipientName)},</p>
                <p style="margin:0 0 24px 0;font-size:15px;line-height:1.55;color:#4a4a68;">Welcome to Kolaleaf. Please verify your email to start sending money.</p>
                <div style="margin:0 0 24px 0;">
                  <a href="${escapeAttr(verificationUrl)}" style="display:inline-block;background:#6d4aff;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:500;">Verify email</a>
                </div>
                <p style="margin:0 0 8px 0;font-size:13px;line-height:1.5;color:#6a6a88;">Or paste this link into your browser:</p>
                <p style="margin:0 0 24px 0;font-size:13px;line-height:1.5;color:#6a6a88;word-break:break-all;"><a href="${escapeAttr(verificationUrl)}" style="color:#6d4aff;text-decoration:underline;">${escapeHtml(verificationUrl)}</a></p>
                <p style="margin:0 0 8px 0;font-size:13px;line-height:1.5;color:#6a6a88;">This link expires in ${expiresInHours} hours.</p>
                <p style="margin:0;font-size:13px;line-height:1.5;color:#6a6a88;">If you didn't create a Kolaleaf account, you can safely ignore this message.</p>
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
