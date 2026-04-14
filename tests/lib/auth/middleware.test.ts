import { describe, it, expect } from 'vitest'
import {
  getSessionTokenFromCookie,
  setSessionCookie,
  clearSessionCookie,
  AuthError,
} from '@/lib/auth/middleware'

describe('getSessionTokenFromCookie', () => {
  it('returns null for null cookie header', () => {
    expect(getSessionTokenFromCookie(null)).toBeNull()
  })

  it('returns null when session cookie is absent', () => {
    expect(getSessionTokenFromCookie('other_cookie=abc')).toBeNull()
  })

  it('extracts session token from cookie header', () => {
    expect(getSessionTokenFromCookie('kolaleaf_session=abc123')).toBe('abc123')
  })

  it('extracts token when multiple cookies present', () => {
    const header = 'foo=bar; kolaleaf_session=mytoken; baz=qux'
    expect(getSessionTokenFromCookie(header)).toBe('mytoken')
  })

  it('handles whitespace in cookie values', () => {
    const header = 'kolaleaf_session= spaced_token '
    expect(getSessionTokenFromCookie(header)).toBe('spaced_token')
  })
})

describe('setSessionCookie', () => {
  it('creates a cookie string with correct attributes', () => {
    const cookie = setSessionCookie('test-token')
    expect(cookie).toContain('kolaleaf_session=test-token')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('Max-Age=900')
  })
})

describe('clearSessionCookie', () => {
  it('creates a cookie string that expires the cookie', () => {
    const cookie = clearSessionCookie()
    expect(cookie).toContain('kolaleaf_session=')
    expect(cookie).toContain('Max-Age=0')
  })
})

describe('AuthError', () => {
  it('has correct name and statusCode', () => {
    const err = new AuthError(401, 'Not authenticated')
    expect(err.name).toBe('AuthError')
    expect(err.statusCode).toBe(401)
    expect(err.message).toBe('Not authenticated')
    expect(err).toBeInstanceOf(Error)
  })

  it('can represent 403 status', () => {
    const err = new AuthError(403, 'KYC required')
    expect(err.statusCode).toBe(403)
  })
})
