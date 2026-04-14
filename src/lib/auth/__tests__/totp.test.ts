import { describe, it, expect } from 'vitest'
import { generateSync } from 'otplib'
import { generateTotpSecret, verifyTotpToken, generateBackupCodes } from '../totp'

describe('TOTP service', () => {
  it('generates a valid base32 secret', () => {
    const result = generateTotpSecret('user@example.com')
    expect(result.secret).toMatch(/^[A-Z2-7]+=*$/)
    expect(result.uri).toContain('otpauth://totp/')
    expect(result.uri).toContain('Kolaleaf')
    // URI encodes @ as %40
    expect(result.uri).toMatch(/user(%40|@)example\.com/)
  })

  it('verifies a correct TOTP token', () => {
    const { secret } = generateTotpSecret('user@example.com')
    const token = generateSync({ secret })
    expect(verifyTotpToken(secret, token)).toBe(true)
  })

  it('rejects an incorrect TOTP token', () => {
    const { secret } = generateTotpSecret('user@example.com')
    expect(verifyTotpToken(secret, '999999')).toBe(false)
  })

  it('generates 10 unique backup codes of 8 chars each', () => {
    const codes = generateBackupCodes()
    expect(codes).toHaveLength(10)
    const unique = new Set(codes)
    expect(unique.size).toBe(10)
    for (const code of codes) {
      expect(code).toMatch(/^[a-f0-9]{8}$/)
    }
  })

  it('generates custom count of backup codes', () => {
    const codes = generateBackupCodes(5)
    expect(codes).toHaveLength(5)
  })
})
