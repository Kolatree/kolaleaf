import { describe, it, expect, afterEach, vi } from 'vitest'
import { isKycGateDisabled, assertKycGateSafe } from '../flag'

describe('isKycGateDisabled', () => {
  afterEach(() => {
    delete process.env.KOLA_DISABLE_KYC_GATE
    vi.unstubAllEnvs()
  })

  it('returns false when flag is unset', () => {
    delete process.env.KOLA_DISABLE_KYC_GATE
    expect(isKycGateDisabled()).toBe(false)
  })

  it('returns true only when flag is exactly "true"', () => {
    process.env.KOLA_DISABLE_KYC_GATE = 'true'
    expect(isKycGateDisabled()).toBe(true)
  })

  it('returns false for non-canonical truthy values (strict mode)', () => {
    for (const v of ['TRUE', '1', 'yes', 'on', ' true ']) {
      process.env.KOLA_DISABLE_KYC_GATE = v
      expect(isKycGateDisabled()).toBe(false)
    }
  })
})

describe('assertKycGateSafe', () => {
  afterEach(() => {
    delete process.env.KOLA_DISABLE_KYC_GATE
    vi.unstubAllEnvs()
  })

  it('returns normally when flag is off (any NODE_ENV)', () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.KOLA_DISABLE_KYC_GATE
    expect(() => assertKycGateSafe()).not.toThrow()
  })

  it('returns normally when flag is on in development', () => {
    vi.stubEnv('NODE_ENV', 'development')
    process.env.KOLA_DISABLE_KYC_GATE = 'true'
    expect(() => assertKycGateSafe()).not.toThrow()
  })

  it('returns normally in test environment with flag on', () => {
    vi.stubEnv('NODE_ENV', 'test')
    process.env.KOLA_DISABLE_KYC_GATE = 'true'
    expect(() => assertKycGateSafe()).not.toThrow()
  })

  it('throws in production when flag is on — the AUSTRAC tripwire', () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.KOLA_DISABLE_KYC_GATE = 'true'
    expect(() => assertKycGateSafe()).toThrow(/KOLA_DISABLE_KYC_GATE/)
    expect(() => assertKycGateSafe()).toThrow(/forbidden in production/)
  })
})
