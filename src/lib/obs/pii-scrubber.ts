const SENSITIVE_KEYS = new Set([
  'accountname',
  'address',
  'authorization',
  'birthdate',
  'cookie',
  'dob',
  'email',
  'firstname',
  'fullname',
  'identifier',
  'ip',
  'lastname',
  'password',
  'phone',
  'secret',
  'session',
  'token',
])

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const PHONE_RE = /\+\d{8,15}\b/g
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi
const COOKIE_RE = /\bkolaleaf_(?:session|pending_2fa)=[^;\s]+/gi

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase()
  if (SENSITIVE_KEYS.has(normalized)) return true
  return (
    normalized.endsWith('token') ||
    normalized.endsWith('secret') ||
    normalized.endsWith('email') ||
    normalized.endsWith('phone') ||
    normalized.includes('password') ||
    normalized.includes('cookie')
  )
}

function scrubString(value: string): string {
  return value
    .replace(BEARER_RE, 'Bearer [REDACTED]')
    .replace(COOKIE_RE, (match) => `${match.split('=')[0]}=[REDACTED]`)
    .replace(EMAIL_RE, '[REDACTED_EMAIL]')
    .replace(PHONE_RE, '[REDACTED_PHONE]')
}

export function scrubPiiForSentry<T>(input: T, depth = 0): T {
  if (depth > 8) return '[REDACTED_DEPTH]' as T
  if (typeof input === 'string') return scrubString(input) as T
  if (input === null || input === undefined) return input
  if (typeof input !== 'object') return input
  if (input instanceof Date) return input
  if (input instanceof Error) {
    return {
      name: input.name,
      message: scrubString(input.message),
      stack: input.stack ? scrubString(input.stack) : undefined,
      ...scrubPiiForSentry(Object.fromEntries(Object.entries(input)), depth + 1),
    } as T
  }

  if (Array.isArray(input)) {
    return input.map((item) => scrubPiiForSentry(item, depth + 1)) as T
  }

  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    output[key] = isSensitiveKey(key)
      ? '[REDACTED]'
      : scrubPiiForSentry(value, depth + 1)
  }
  return output as T
}

export const scrubPiiForLogs = scrubPiiForSentry
