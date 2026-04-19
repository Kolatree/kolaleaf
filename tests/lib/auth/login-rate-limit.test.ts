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

  it('allows the first five failures inside the window and blocks the sixth', () => {
    const now = Date.now()

    for (let i = 0; i < 5; i += 1) {
      expect(checkLoginRateLimit('user@example.com', '1.2.3.4', now).allowed).toBe(true)
      recordLoginFailure('user@example.com', '1.2.3.4', now)
    }

    const blocked = checkLoginRateLimit('user@example.com', '1.2.3.4', now)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterMs).toBeGreaterThan(0)
  })

  it('tracks identifier and IP separately', () => {
    const now = Date.now()

    for (let i = 0; i < 5; i += 1) {
      recordLoginFailure('user@example.com', undefined, now)
    }

    expect(checkLoginRateLimit('user@example.com', undefined, now).allowed).toBe(false)
    expect(checkLoginRateLimit('other@example.com', undefined, now).allowed).toBe(true)
  })

  it('resets the window after expiry', () => {
    const now = Date.now()

    for (let i = 0; i < 5; i += 1) {
      recordLoginFailure('user@example.com', '1.2.3.4', now)
    }

    expect(checkLoginRateLimit('user@example.com', '1.2.3.4', now).allowed).toBe(false)
    expect(checkLoginRateLimit('user@example.com', '1.2.3.4', now + 16 * 60 * 1000).allowed).toBe(true)
  })

  it('clears the limiter after a successful or verified login', () => {
    const now = Date.now()

    for (let i = 0; i < 5; i += 1) {
      recordLoginFailure('user@example.com', '1.2.3.4', now)
    }

    clearLoginRateLimit('user@example.com', '1.2.3.4')
    expect(checkLoginRateLimit('user@example.com', '1.2.3.4', now).allowed).toBe(true)
  })
})
