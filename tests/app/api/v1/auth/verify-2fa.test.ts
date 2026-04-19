import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/middleware', () => ({
  requirePendingTwoFactorChallenge: vi.fn(),
  clearPendingTwoFactorCookie: vi.fn(() => 'kolaleaf_pending_2fa=; Max-Age=0'),
  setSessionCookie: vi.fn(() => 'kolaleaf_session=tok; HttpOnly'),
  AuthError: class extends Error {
    statusCode: number
    constructor(statusCode: number, msg: string) {
      super(msg)
      this.name = 'AuthError'
      this.statusCode = statusCode
    }
  },
}))

vi.mock('@/lib/db/client', () => ({
  prisma: {
    twoFactorChallenge: { findUnique: vi.fn() },
    user: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  },
}))

vi.mock('@/lib/auth/totp', () => ({
  verifyTotpCode: vi.fn(() => false),
  verifyBackupCode: vi.fn(async () => ({ valid: false, remainingHashes: [] })),
}))

vi.mock('@/lib/auth/two-factor-challenge', () => ({
  verifyChallenge: vi.fn(async () => false),
  consumeChallenge: vi.fn(async () => undefined),
}))

vi.mock('@/lib/auth/audit', () => ({
  logAuthEvent: vi.fn(async () => undefined),
}))

vi.mock('@/lib/auth/sessions', () => ({
  createSession: vi.fn(async () => ({ token: 'tok' })),
}))

vi.mock('@/lib/security/anomaly', () => ({
  recordSecurityAnomalyCheck: vi.fn(async () => undefined),
}))

import { POST } from '@/app/api/v1/auth/verify-2fa/route'
import { requirePendingTwoFactorChallenge } from '@/lib/auth/middleware'

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/auth/verify-2fa', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: 'kolaleaf_pending_2fa=challenge-1',
    },
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/auth/verify-2fa (schema validation)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requirePendingTwoFactorChallenge).mockReturnValue({ challengeId: 'challenge-1' })
  })

  it('returns 400 malformed_json on invalid JSON', async () => {
    const req = new Request('http://localhost/api/v1/auth/verify-2fa', {
      method: 'POST',
      body: 'not-json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.reason).toBe('malformed_json')
  })

  it('returns 422 when code is missing (Zod)', async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.fields?.code).toBeInstanceOf(Array)
  })

  it('returns 422 when code is wrong type (Zod)', async () => {
    const res = await POST(makeRequest({ code: 123456 }))
    expect(res.status).toBe(422)
  })
})
