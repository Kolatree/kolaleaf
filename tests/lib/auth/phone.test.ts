import { describe, it, expect } from 'vitest'
import {
  normalizePhone,
  generateSmsCode,
  verifySmsCode,
  InvalidPhoneError,
} from '@/lib/auth/phone'

describe('normalizePhone', () => {
  it('accepts already-E.164 input unchanged', () => {
    expect(normalizePhone('+61400000000')).toBe('+61400000000')
  })

  it('strips spaces, dashes, and parens', () => {
    expect(normalizePhone('+61 400 000 000')).toBe('+61400000000')
    expect(normalizePhone('+61-400-000-000')).toBe('+61400000000')
    expect(normalizePhone('+1 (555) 010-9999')).toBe('+15550109999')
  })

  it('throws InvalidPhoneError when missing leading +', () => {
    expect(() => normalizePhone('61400000000')).toThrow(InvalidPhoneError)
  })

  it('throws InvalidPhoneError for too-short number', () => {
    expect(() => normalizePhone('+12345')).toThrow(InvalidPhoneError)
  })

  it('throws InvalidPhoneError for too-long number', () => {
    expect(() => normalizePhone('+1234567890123456')).toThrow(InvalidPhoneError)
  })

  it('throws InvalidPhoneError for non-digit content', () => {
    expect(() => normalizePhone('+1abc4567890')).toThrow(InvalidPhoneError)
  })

  it('throws InvalidPhoneError for empty input', () => {
    expect(() => normalizePhone('')).toThrow(InvalidPhoneError)
  })
})

describe('generateSmsCode', () => {
  it('returns a 6-digit zero-padded string', () => {
    for (let i = 0; i < 50; i++) {
      const { code } = generateSmsCode()
      expect(code).toMatch(/^\d{6}$/)
    }
  })

  it('returns a non-empty bcrypt-style hash that does not equal the raw code', () => {
    const { code, hash } = generateSmsCode()
    expect(hash.length).toBeGreaterThan(0)
    expect(hash).not.toBe(code)
  })

  it('produces varied codes across calls', () => {
    const codes = new Set<string>()
    for (let i = 0; i < 20; i++) {
      codes.add(generateSmsCode().code)
    }
    // With a 1-in-a-million collision rate across 20 draws, we expect close to 20 unique.
    expect(codes.size).toBeGreaterThan(15)
  })
})

describe('verifySmsCode', () => {
  it('round-trip: verify returns true for the matching code', async () => {
    const { code, hash } = generateSmsCode()
    await expect(verifySmsCode(code, hash)).resolves.toBe(true)
  })

  it('returns false for a non-matching code', async () => {
    const { hash } = generateSmsCode()
    await expect(verifySmsCode('000000', hash)).resolves.toBe(false)
  })
})
