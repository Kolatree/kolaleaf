import { describe, it, expect, afterEach, vi } from 'vitest'
import { createHash } from 'node:crypto'
import {
  extractRequestContext,
  truncateIp,
  sanitizeUserAgent,
} from '@/lib/security/request-context'

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/test', { headers })
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('extractRequestContext', () => {
  it('returns an all-undefined context for a bare request', () => {
    const ctx = extractRequestContext(makeRequest())
    expect(ctx.ip).toBeUndefined()
    expect(ctx.ipTruncated).toBeUndefined()
    expect(ctx.country).toBeUndefined()
    expect(ctx.deviceFingerprintHash).toBeUndefined()
    expect(ctx.userAgent).toBeUndefined()
  })

  it('reads IP from x-forwarded-for and truncates it to /24', () => {
    const ctx = extractRequestContext(
      makeRequest({ 'x-forwarded-for': '203.0.113.42' }),
    )
    expect(ctx.ip).toBe('203.0.113.42')
    expect(ctx.ipTruncated).toBe('203.0.113.0')
  })

  it('truncates IPv6 to /48', () => {
    // Uses a well-formed IPv6 since the validator enforces shape.
    const ctx = extractRequestContext(
      makeRequest({ 'x-forwarded-for': '2001:db8:1234:5678:9abc:def0:1234:5678' }),
    )
    expect(ctx.ipTruncated).toBe('2001:db8:1234::/48')
  })

  describe('country header (trust gated on EDGE_PROVIDER)', () => {
    it('returns undefined when EDGE_PROVIDER is unset — Railway direct', () => {
      vi.stubEnv('EDGE_PROVIDER', '')
      const ctx = extractRequestContext(makeRequest({ 'cf-ipcountry': 'AU' }))
      expect(ctx.country).toBeUndefined()
    })

    it('returns undefined for an unknown edge value', () => {
      vi.stubEnv('EDGE_PROVIDER', 'aws-cloudfront')
      const ctx = extractRequestContext(makeRequest({ 'cf-ipcountry': 'AU' }))
      expect(ctx.country).toBeUndefined()
    })

    it('reads cf-ipcountry when EDGE_PROVIDER=cloudflare', () => {
      vi.stubEnv('EDGE_PROVIDER', 'cloudflare')
      const ctx = extractRequestContext(makeRequest({ 'cf-ipcountry': 'au' }))
      expect(ctx.country).toBe('AU')
    })

    it('reads x-vercel-ip-country when EDGE_PROVIDER=vercel', () => {
      vi.stubEnv('EDGE_PROVIDER', 'vercel')
      const ctx = extractRequestContext(
        makeRequest({ 'x-vercel-ip-country': 'NG' }),
      )
      expect(ctx.country).toBe('NG')
    })

    it('prefers cf-ipcountry over x-vercel-ip-country when both are present', () => {
      vi.stubEnv('EDGE_PROVIDER', 'cloudflare')
      const ctx = extractRequestContext(
        makeRequest({ 'cf-ipcountry': 'AU', 'x-vercel-ip-country': 'NG' }),
      )
      expect(ctx.country).toBe('AU')
    })

    it('preserves Cloudflare sentinels (XX, T1) as real signals', () => {
      vi.stubEnv('EDGE_PROVIDER', 'cloudflare')
      const xx = extractRequestContext(makeRequest({ 'cf-ipcountry': 'XX' }))
      const t1 = extractRequestContext(makeRequest({ 'cf-ipcountry': 'T1' }))
      expect(xx.country).toBe('XX')
      expect(t1.country).toBe('T1')
    })

    it('treats whitespace-only country header as absent', () => {
      vi.stubEnv('EDGE_PROVIDER', 'cloudflare')
      const ctx = extractRequestContext(makeRequest({ 'cf-ipcountry': '   ' }))
      expect(ctx.country).toBeUndefined()
    })
  })

  describe('device fingerprint', () => {
    it('hashes over (UA, accept-language, accept-encoding)', () => {
      const ctx = extractRequestContext(
        makeRequest({
          'user-agent': 'Chrome/123',
          'accept-language': 'en-AU',
          'accept-encoding': 'gzip',
        }),
      )
      const expected = createHash('sha256')
        .update('Chrome/123|en-AU|gzip')
        .digest('hex')
      expect(ctx.deviceFingerprintHash).toBe(expected)
    })

    it('produces different fingerprints for different UAs', () => {
      const a = extractRequestContext(makeRequest({ 'user-agent': 'A' }))
      const b = extractRequestContext(makeRequest({ 'user-agent': 'B' }))
      expect(a.deviceFingerprintHash).not.toBe(b.deviceFingerprintHash)
    })
  })

  describe('userAgent sanitization (via helper — undici blocks control chars at Request construction)', () => {
    it('strips ASCII control chars', () => {
      expect(sanitizeUserAgent('Mozilla\x00\x1bfake-log-line\x7f')).toBe(
        'Mozillafake-log-line',
      )
    })

    it('caps user-agent length at 512 via the full request path', () => {
      const long = 'A'.repeat(2000)
      const ctx = extractRequestContext(makeRequest({ 'user-agent': long }))
      expect(ctx.userAgent?.length).toBe(512)
    })

    it('returns undefined when the UA reduces to empty after sanitization', () => {
      expect(sanitizeUserAgent('\x00\x01')).toBeUndefined()
    })

    it('returns undefined for null/empty input', () => {
      expect(sanitizeUserAgent(null)).toBeUndefined()
      expect(sanitizeUserAgent('')).toBeUndefined()
      expect(sanitizeUserAgent(undefined)).toBeUndefined()
    })
  })
})

describe('truncateIp', () => {
  it('zeroes the last IPv4 octet', () => {
    expect(truncateIp('10.20.30.40')).toBe('10.20.30.0')
  })

  it('preserves IPv4 network + subnet', () => {
    expect(truncateIp('192.168.1.255')).toBe('192.168.1.0')
  })

  it('collapses IPv6 to the first 48 bits', () => {
    expect(truncateIp('2001:db8:1234:5678::1')).toBe('2001:db8:1234::/48')
  })

  it('returns undefined for malformed input', () => {
    expect(truncateIp('not-an-ip')).toBeUndefined()
  })
})
