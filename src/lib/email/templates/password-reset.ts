/**
 * Kolaleaf — password reset template.
 *
 * Includes IP + user-agent (when available) so the user can spot a foreign
 * request they didn't initiate. Text body stays scannable for email clients
 * that strip HTML entirely.
 */

export interface PasswordResetEmailParams {
  recipientName: string
  resetUrl: string
  expiresInMinutes: number
  ip?: string
  userAgent?: string
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

export function renderPasswordResetEmail(params: PasswordResetEmailParams): RenderedEmail {
  const { recipientName, resetUrl, expiresInMinutes, ip, userAgent } = params

  const subject = 'Reset your Kolaleaf password'

  const contextLines: string[] = []
  if (ip) contextLines.push(`IP address: ${ip}`)
  if (userAgent) contextLines.push(`Device/browser: ${userAgent}`)
  const contextBlock = contextLines.length
    ? `\n\nThis request came from:\n${contextLines.map((l) => `  • ${l}`).join('\n')}`
    : ''

  const text = `Hi ${recipientName},

Someone requested a password reset for your Kolaleaf account.

Reset your password here: ${resetUrl}

This link expires in ${expiresInMinutes} minutes.${contextBlock}

If you didn't request this, ignore this email — your password hasn't changed. For your security, any active sessions will be signed out when you complete the reset.

— The Kolaleaf team`

  const ipRow = ip
    ? `<tr><td style="padding:4px 0;color:#6a6a88;font-size:13px;">IP address</td><td style="padding:4px 0 4px 16px;color:#1a1a2e;font-size:13px;font-family:monospace;">${escapeHtml(ip)}</td></tr>`
    : ''
  const uaRow = userAgent
    ? `<tr><td style="padding:4px 0;color:#6a6a88;font-size:13px;">Device</td><td style="padding:4px 0 4px 16px;color:#1a1a2e;font-size:13px;">${escapeHtml(userAgent)}</td></tr>`
    : ''
  const contextTable = ipRow || uaRow
    ? `<div style="margin:16px 0 24px 0;padding:12px 16px;background:#f6f7fb;border-radius:8px;">
         <div style="font-size:12px;color:#6a6a88;margin-bottom:6px;">This request came from</div>
         <table role="presentation" cellspacing="0" cellpadding="0">${ipRow}${uaRow}</table>
       </div>`
    : ''

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
                <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:600;color:#1a1a2e;">Reset your password</h1>
                <p style="margin:0 0 16px 0;font-size:15px;line-height:1.55;color:#4a4a68;">Hi ${escapeHtml(recipientName)},</p>
                <p style="margin:0 0 24px 0;font-size:15px;line-height:1.55;color:#4a4a68;">Someone requested a password reset for your Kolaleaf account.</p>
                <div style="margin:0 0 24px 0;">
                  <a href="${escapeAttr(resetUrl)}" style="display:inline-block;background:#6d4aff;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:500;">Reset password</a>
                </div>
                <p style="margin:0 0 8px 0;font-size:13px;line-height:1.5;color:#6a6a88;">Or paste this link into your browser:</p>
                <p style="margin:0 0 24px 0;font-size:13px;line-height:1.5;color:#6a6a88;word-break:break-all;"><a href="${escapeAttr(resetUrl)}" style="color:#6d4aff;text-decoration:underline;">${escapeHtml(resetUrl)}</a></p>
                <p style="margin:0 0 16px 0;font-size:13px;line-height:1.5;color:#6a6a88;">This link expires in ${expiresInMinutes} minutes.</p>
                ${contextTable}
                <p style="margin:0;font-size:13px;line-height:1.5;color:#6a6a88;">If you didn't request this, ignore this email — your password hasn't changed. For your security, any active sessions will be signed out when you complete the reset.</p>
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
