import { beforeEach, describe, expect, it } from 'vitest'
import {
  __resetLoginRateLimitForTests,
  checkLoginRateLimit,
  clearLoginRateLimit,
  recordLoginFailure,
} from '@/lib/auth/login-rate-limit'

describe('login rate limiter', () => {
  beforeEach(() => {
    __resetLoginRateLimitForTests()
  })

  it('allows the first five failures inside the window and blocks the sixth', async () => {
    const now = Date.now()

    for (let i = 0; i < 5; i += 1) {
      expect((await checkLoginRateLimit('user@example.com', '1.2.3.4', now)).allowed).toBe(true)
      await recordLoginFailure('user@example.com', '1.2.3.4', now)
    }

    const blocked = await checkLoginRateLimit('user@example.com', '1.2.3.4', now)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterMs).toBeGreaterThan(0)
  })

  it('tracks identifier and IP separately', async () => {
    const now = Date.now()

    for (let i = 0; i < 5; i += 1) {
      await recordLoginFailure('user@example.com', undefined, now)
    }

    expect((await checkLoginRateLimit('user@example.com', undefined, now)).allowed).toBe(false)
    expect((await checkLoginRateLimit('other@example.com', undefined, now)).allowed).toBe(true)
  })

  it('resets the window after expiry', async () => {
    const now = Date.now()

    for (let i = 0; i < 5; i += 1) {
      await recordLoginFailure('user@example.com', '1.2.3.4', now)
    }

    expect((await checkLoginRateLimit('user@example.com', '1.2.3.4', now)).allowed).toBe(false)
    expect((await checkLoginRateLimit('user@example.com', '1.2.3.4', now + 16 * 60 * 1000)).allowed).toBe(true)
  })

  it('clears the limiter after a successful or verified login', async () => {
    const now = Date.now()

    for (let i = 0; i < 5; i += 1) {
      await recordLoginFailure('user@example.com', '1.2.3.4', now)
    }

    await clearLoginRateLimit('user@example.com', '1.2.3.4')
    expect((await checkLoginRateLimit('user@example.com', '1.2.3.4', now)).allowed).toBe(true)
  })
})
