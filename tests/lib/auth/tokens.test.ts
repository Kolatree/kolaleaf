import { describe, it, expect } from 'vitest'
import { generateVerificationToken, hashToken } from '@/lib/auth/tokens'

describe('generateVerificationToken', () => {
  it('returns raw and hash', () => {
    const t = generateVerificationToken()
    expect(t.raw).toBeTypeOf('string')
    expect(t.hash).toBeTypeOf('string')
  })

  it('raw is 64 hex chars (32 bytes)', () => {
    const { raw } = generateVerificationToken()
    expect(raw).toHaveLength(64)
    expect(raw).toMatch(/^[0-9a-f]{64}$/)
  })

  it('hash is 64 hex chars (sha256)', () => {
    const { hash } = generateVerificationToken()
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('raw is not equal to hash', () => {
    const t = generateVerificationToken()
    expect(t.raw).not.toBe(t.hash)
  })

  it('generates different raw tokens across calls', () => {
    const a = generateVerificationToken()
    const b = generateVerificationToken()
    expect(a.raw).not.toBe(b.raw)
  })

  it('hash(raw) matches the returned hash', () => {
    const { raw, hash } = generateVerificationToken()
    expect(hashToken(raw)).toBe(hash)
  })
})

describe('hashToken', () => {
  it('is deterministic', () => {
    expect(hashToken('hello')).toBe(hashToken('hello'))
  })

  it('produces different hashes for different inputs', () => {
    expect(hashToken('hello')).not.toBe(hashToken('world'))
  })

  it('returns 64 hex chars', () => {
    const h = hashToken('abc')
    expect(h).toHaveLength(64)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })
})
