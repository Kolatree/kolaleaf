export interface OpsAlertEmailParams {
  event: string
  data: Record<string, unknown>
  env: string
  occurredAt: string
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

// Ops alert template. Plain-text forward because ops inboxes often
// strip HTML. The subject line encodes env + event so filters and
// pager rules can route on `[prod] alert.float.low` without parsing
// the body.
export function renderOpsAlertEmail(params: OpsAlertEmailParams): RenderedEmail {
  const { event, data, env, occurredAt } = params
  const subject = `[${env}] ${event}`

  const dataLines = Object.entries(data)
    .map(([k, v]) => `  ${k}: ${formatValue(v)}`)
    .join('\n')

  const text = `Kolaleaf ops alert

Event:       ${event}
Environment: ${env}
Occurred at: ${occurredAt}

Payload:
${dataLines || '  (no data)'}

— Kolaleaf observability pipeline
`

  const html = `<!DOCTYPE html>
<html><body style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
  <h2 style="margin:0 0 16px 0;color:#2a2a3a;">Kolaleaf ops alert</h2>
  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-bottom:16px;">
    <tr><td style="padding:4px 0;color:#6a6a88;width:140px;">Event</td><td style="padding:4px 0;color:#2a2a3a;"><code>${escape(event)}</code></td></tr>
    <tr><td style="padding:4px 0;color:#6a6a88;">Environment</td><td style="padding:4px 0;color:#2a2a3a;">${escape(env)}</td></tr>
    <tr><td style="padding:4px 0;color:#6a6a88;">Occurred at</td><td style="padding:4px 0;color:#2a2a3a;">${escape(occurredAt)}</td></tr>
  </table>
  <h3 style="margin:16px 0 8px 0;color:#4a4a68;font-size:14px;">Payload</h3>
  <pre style="background:#f3f3fa;padding:12px;border-radius:6px;font-size:12px;overflow-x:auto;">${escape(JSON.stringify(data, null, 2))}</pre>
</body></html>`

  return { subject, html, text }
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return String(v)
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
