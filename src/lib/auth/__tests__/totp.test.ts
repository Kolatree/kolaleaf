import { describe, it, expect } from 'vitest'
import { generateSync } from 'otplib'
import {
  generateTotpSecret,
  buildOtpauthUri,
  generateQrCodeDataUrl,
  verifyTotpCode,
  generateBackupCodes,
  verifyBackupCode,
} from '../totp'

describe('TOTP helpers', () => {
  it('generateTotpSecret returns a base32 string', () => {
    const secret = generateTotpSecret()
    expect(secret).toMatch(/^[A-Z2-7]+=*$/)
    // Default 20-byte secret encodes to 32 base32 chars
    expect(secret.length).toBeGreaterThanOrEqual(16)
  })

  it('buildOtpauthUri embeds issuer and account label', () => {
    const secret = generateTotpSecret()
    const uri = buildOtpauthUri({ secret, accountLabel: 'user@example.com' })
    expect(uri).toContain('otpauth://totp/')
    expect(uri).toContain('Kolaleaf')
    // URI encodes '@' as %40
    expect(uri).toMatch(/user(%40|@)example\.com/)
    expect(uri).toContain(`secret=${secret}`)
  })

  it('buildOtpauthUri accepts a custom issuer', () => {
    const secret = generateTotpSecret()
    const uri = buildOtpauthUri({ secret, accountLabel: 'a@b.com', issuer: 'CustomCo' })
    expect(uri).toContain('CustomCo')
  })

  it('generateQrCodeDataUrl returns a png data URL', async () => {
    const secret = generateTotpSecret()
    const uri = buildOtpauthUri({ secret, accountLabel: 'a@b.com' })
    const dataUrl = await generateQrCodeDataUrl(uri)
    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true)
    expect(dataUrl.length).toBeGreaterThan(200)
  })

  it('verifyTotpCode returns true for a freshly generated code', () => {
    const secret = generateTotpSecret()
    const token = generateSync({ secret })
    expect(verifyTotpCode(secret, token)).toBe(true)
  })

  it('verifyTotpCode returns false for an obviously wrong code', () => {
    const secret = generateTotpSecret()
    expect(verifyTotpCode(secret, '000000')).toBe(false)
  })

  it('verifyTotpCode returns false for empty inputs', () => {
    expect(verifyTotpCode('', '123456')).toBe(false)
    expect(verifyTotpCode('ABC', '')).toBe(false)
  })

  it('generateBackupCodes returns 8 codes + hashes by default', () => {
    const { codes, hashes } = generateBackupCodes()
    expect(codes).toHaveLength(8)
    expect(hashes).toHaveLength(8)
    for (const code of codes) {
      // XXXX-XXXXXX format
      expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{6}$/)
    }
    // Hashes are bcrypt
    for (const hash of hashes) {
      expect(hash.startsWith('$2')).toBe(true)
    }
    // Unique
    expect(new Set(codes).size).toBe(8)
  })

  it('generateBackupCodes honours count argument', () => {
    const { codes, hashes } = generateBackupCodes(4)
    expect(codes).toHaveLength(4)
    expect(hashes).toHaveLength(4)
  })

  it('verifyBackupCode matches a raw code and removes the used hash', async () => {
    const { codes, hashes } = generateBackupCodes(3)
    const result = await verifyBackupCode(codes[1], hashes)
    expect(result.valid).toBe(true)
    expect(result.remainingHashes).toHaveLength(2)
    // The remaining hashes are the ones that were NOT consumed
    expect(result.remainingHashes).toEqual([hashes[0], hashes[2]])
  })

  it('verifyBackupCode is case-insensitive on the input', async () => {
    const { codes, hashes } = generateBackupCodes(2)
    const lower = codes[0].toLowerCase()
    const result = await verifyBackupCode(lower, hashes)
    expect(result.valid).toBe(true)
  })

  it('verifyBackupCode tolerates missing separator in input', async () => {
    const { codes, hashes } = generateBackupCodes(2)
    const withoutDash = codes[0].replace('-', '')
    const result = await verifyBackupCode(withoutDash, hashes)
    expect(result.valid).toBe(true)
  })

  it('verifyBackupCode returns {valid:false, remainingHashes:original} on miss', async () => {
    const { hashes } = generateBackupCodes(3)
    const result = await verifyBackupCode('ZZZZ-ZZZZZZ', hashes)
    expect(result.valid).toBe(false)
    expect(result.remainingHashes).toEqual(hashes)
  })

  it('verifyBackupCode returns false on empty hash list', async () => {
    const result = await verifyBackupCode('AAAA-BBBBBB', [])
    expect(result.valid).toBe(false)
    expect(result.remainingHashes).toEqual([])
  })
})
