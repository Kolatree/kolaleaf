import { describe, it, expect } from 'vitest'
import crypto from 'crypto'
import { verifyHmac, verifyStaticSecret } from '../verify-hmac'

describe('verifyHmac', () => {
  const secret = 'test-secret'
  const payload = '{"event":"test"}'

  function sign(algorithm: 'sha256' | 'sha512', body: string, key: string): string {
    return crypto.createHmac(algorithm, key).update(body).digest('hex')
  }

  it('returns true for valid sha256 signature', () => {
    const sig = sign('sha256', payload, secret)
    expect(verifyHmac('sha256', payload, sig, secret)).toBe(true)
  })

  it('returns true for valid sha512 signature', () => {
    const sig = sign('sha512', payload, secret)
    expect(verifyHmac('sha512', payload, sig, secret)).toBe(true)
  })

  it('returns false for wrong signature', () => {
    expect(verifyHmac('sha256', payload, 'deadbeef', secret)).toBe(false)
  })

  it('returns false for wrong secret', () => {
    const sig = sign('sha256', payload, secret)
    expect(verifyHmac('sha256', payload, sig, 'wrong-secret')).toBe(false)
  })

  it('returns false for empty signature', () => {
    expect(verifyHmac('sha256', payload, '', secret)).toBe(false)
  })

  it('returns false for malformed hex (non-hex chars)', () => {
    expect(verifyHmac('sha256', payload, 'not-hex-zzzz', secret)).toBe(false)
  })
})

describe('verifyStaticSecret', () => {
  it('returns true for matching strings', () => {
    expect(verifyStaticSecret('my-secret', 'my-secret')).toBe(true)
  })

  it('returns false for different strings', () => {
    expect(verifyStaticSecret('my-secret', 'other-secret')).toBe(false)
  })

  it('returns false for different length strings', () => {
    expect(verifyStaticSecret('short', 'much-longer-string')).toBe(false)
  })

  it('returns false for empty received', () => {
    expect(verifyStaticSecret('', 'expected')).toBe(false)
  })

  it('returns false for empty expected', () => {
    expect(verifyStaticSecret('received', '')).toBe(false)
  })
})
