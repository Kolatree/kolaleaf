import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { extractRequestContext } from '@/lib/security/request-context'

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/test', { headers })
}

describe('extractRequestContext', () => {
  it('returns an all-undefined context for a bare request', () => {
    const ctx = extractRequestContext(makeRequest())
    expect(ctx).toEqual({
      ip: undefined,
      country: undefined,
      deviceFingerprintHash: undefined,
      userAgent: undefined,
    })
  })

  it('reads IP from x-forwarded-for via getClientIp', () => {
    const ctx = extractRequestContext(
      makeRequest({ 'x-forwarded-for': '203.0.113.42' }),
    )
    expect(ctx.ip).toBe('203.0.113.42')
  })

  it('reads country from cf-ipcountry and upper-cases it', () => {
    const ctx = extractRequestContext(makeRequest({ 'cf-ipcountry': 'au' }))
    expect(ctx.country).toBe('AU')
  })

  it('reads country from x-vercel-ip-country when cf-ipcountry is absent', () => {
    const ctx = extractRequestContext(
      makeRequest({ 'x-vercel-ip-country': 'NG' }),
    )
    expect(ctx.country).toBe('NG')
  })

  it('prefers cf-ipcountry over x-vercel-ip-country when both are present', () => {
    const ctx = extractRequestContext(
      makeRequest({ 'cf-ipcountry': 'AU', 'x-vercel-ip-country': 'NG' }),
    )
    expect(ctx.country).toBe('AU')
  })

  it('hashes device fingerprint over (UA, accept-language, accept-encoding)', () => {
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

  it('produces different fingerprints for different UAs (guard against hash collision tests)', () => {
    const a = extractRequestContext(makeRequest({ 'user-agent': 'A' }))
    const b = extractRequestContext(makeRequest({ 'user-agent': 'B' }))
    expect(a.deviceFingerprintHash).not.toBe(b.deviceFingerprintHash)
  })

  it('returns userAgent raw for compliance triage', () => {
    const ctx = extractRequestContext(makeRequest({ 'user-agent': 'X/1' }))
    expect(ctx.userAgent).toBe('X/1')
  })

  it('treats empty-string country header as absent', () => {
    const ctx = extractRequestContext(makeRequest({ 'cf-ipcountry': '   ' }))
    expect(ctx.country).toBeUndefined()
  })

  it('preserves Cloudflare sentinel country codes (XX, T1) because those are real anomaly signals', () => {
    const xx = extractRequestContext(makeRequest({ 'cf-ipcountry': 'XX' }))
    const t1 = extractRequestContext(makeRequest({ 'cf-ipcountry': 'T1' }))
    expect(xx.country).toBe('XX')
    expect(t1.country).toBe('T1')
  })
})
