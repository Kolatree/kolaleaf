import { createHmac, randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db/client'
import type { AnalyticsEventBodyInput } from '@/app/api/v1/analytics/events/_schemas'

const ALLOWED_PROPERTY_KEYS = new Set([
  'attempt',
  'count',
  'durationMs',
  'method',
  'result',
  'screen',
  'source',
  'step',
])

const SENSITIVE_KEY_RE = /account|address|amount|bank|email|name|phone|recipient|token/i
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
const PHONE_RE = /\+\d{8,15}\b/

export function hashAnalyticsUserId(userId: string): string {
  const secret =
    process.env.ANALYTICS_HASH_SECRET ??
    process.env.DATABASE_URL ??
    'kolaleaf-dev-analytics-hash-secret'
  return createHmac('sha256', secret).update(userId).digest('hex')
}

export function sanitizeAnalyticsProperties(
  properties: AnalyticsEventBodyInput['properties'],
): Record<string, string | number | boolean> {
  const sanitized: Record<string, string | number | boolean> = {}
  for (const [rawKey, rawValue] of Object.entries(properties).slice(0, 20)) {
    const key = rawKey.trim()
    if (!ALLOWED_PROPERTY_KEYS.has(key)) continue
    if (SENSITIVE_KEY_RE.test(key)) continue
    if (typeof rawValue === 'string') {
      const value = rawValue.trim()
      if (EMAIL_RE.test(value) || PHONE_RE.test(value)) continue
      sanitized[key] = value
      continue
    }
    sanitized[key] = rawValue
  }
  return sanitized
}

export async function recordAnalyticsEvent(
  userId: string,
  input: AnalyticsEventBodyInput,
): Promise<void> {
  const properties = sanitizeAnalyticsProperties(input.properties)
  await prisma.$executeRaw`
    INSERT INTO "AnalyticsEvent" ("id", "userHash", "event", "properties", "occurredAt")
    VALUES (
      ${randomUUID()},
      ${hashAnalyticsUserId(userId)},
      ${input.event},
      ${JSON.stringify(properties)}::jsonb,
      ${input.occurredAt}
    )
  `
}
