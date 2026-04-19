import { describe, it, expect, afterEach, vi } from 'vitest'
import { isStubProvidersEnabled, assertStubProvidersSafe } from '../flag'

describe('isStubProvidersEnabled', () => {
  afterEach(() => {
    delete process.env.KOLA_USE_STUB_PROVIDERS
    vi.unstubAllEnvs()
  })

  it('returns false when flag is unset', () => {
    delete process.env.KOLA_USE_STUB_PROVIDERS
    expect(isStubProvidersEnabled()).toBe(false)
  })

  it('returns true when flag is exactly "true"', () => {
    process.env.KOLA_USE_STUB_PROVIDERS = 'true'
    expect(isStubProvidersEnabled()).toBe(true)
  })

  it('returns false for non-canonical truthy values (strict mode)', () => {
    for (const v of ['TRUE', '1', 'yes', 'on', ' true ']) {
      process.env.KOLA_USE_STUB_PROVIDERS = v
      expect(isStubProvidersEnabled()).toBe(false)
    }
  })
})

describe('assertStubProvidersSafe', () => {
  afterEach(() => {
    delete process.env.KOLA_USE_STUB_PROVIDERS
    vi.unstubAllEnvs()
  })

  it('returns normally when flag is off (any NODE_ENV)', () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.KOLA_USE_STUB_PROVIDERS
    expect(() => assertStubProvidersSafe()).not.toThrow()
  })

  it('returns normally when flag is on in development', () => {
    vi.stubEnv('NODE_ENV', 'development')
    process.env.KOLA_USE_STUB_PROVIDERS = 'true'
    expect(() => assertStubProvidersSafe()).not.toThrow()
  })

  it('throws when flag is on in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.KOLA_USE_STUB_PROVIDERS = 'true'
    expect(() => assertStubProvidersSafe()).toThrow(/KOLA_USE_STUB_PROVIDERS/)
  })

  it('returns normally in test environment with flag on', () => {
    vi.stubEnv('NODE_ENV', 'test')
    process.env.KOLA_USE_STUB_PROVIDERS = 'true'
    expect(() => assertStubProvidersSafe()).not.toThrow()
  })
})
