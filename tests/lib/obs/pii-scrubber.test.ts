import { describe, expect, it } from 'vitest'
import { scrubPiiForSentry } from '@/lib/obs/pii-scrubber'

describe('scrubPiiForSentry', () => {
  it('redacts sensitive fields by key', () => {
    const scrubbed = scrubPiiForSentry({
      email: 'ambrose@example.com',
      phone: '+61400000000',
      password: 'secret',
      nested: {
        accountName: 'Ambrose Example',
        contactEmail: 'ambrose@example.com',
        sessionToken: 'tok_1234567890',
      },
    })

    expect(scrubbed).toEqual({
      email: '[REDACTED]',
      phone: '[REDACTED]',
      password: '[REDACTED]',
      nested: {
        accountName: '[REDACTED]',
        contactEmail: '[REDACTED]',
        sessionToken: '[REDACTED]',
      },
    })
  })

  it('redacts PII patterns inside strings', () => {
    const scrubbed = scrubPiiForSentry({
      message:
        'Email ambrose@example.com, phone +61400000000, cookie kolaleaf_session=abc123; Authorization: Bearer abcdefghijklmnop',
    })

    expect(scrubbed.message).not.toContain('ambrose@example.com')
    expect(scrubbed.message).not.toContain('+61400000000')
    expect(scrubbed.message).not.toContain('kolaleaf_session=abc123')
    expect(scrubbed.message).not.toContain('abcdefghijklmnop')
  })

  it('preserves dates and redacts error messages without dropping diagnostics', () => {
    const timestamp = new Date('2026-05-14T00:00:00.000Z')
    const error = new Error('Failed for ambrose@example.com')
    const scrubbed = scrubPiiForSentry({ timestamp, error })

    expect(scrubbed.timestamp).toBe(timestamp)
    expect(scrubbed.error.name).toBe('Error')
    expect(scrubbed.error.message).toBe('Failed for [REDACTED_EMAIL]')
  })
})
