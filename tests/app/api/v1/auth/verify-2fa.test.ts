import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
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
    user: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  },
}))

vi.mock('@/lib/auth/totp', () => ({
  verifyTotpCode: vi.fn(() => false),
  verifyBackupCode: vi.fn(async () => ({ valid: false, remainingHashes: [] })),
}))

vi.mock('@/lib/auth/two-factor-challenge', () => ({
  verifyChallenge: vi.fn(async () => false),
}))

vi.mock('@/lib/auth/audit', () => ({
  logAuthEvent: vi.fn(async () => undefined),
}))

import { POST } from '@/app/api/v1/auth/verify-2fa/route'
import { requireAuth } from '@/lib/auth/middleware'

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/auth/verify-2fa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/auth/verify-2fa (schema validation)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Auth runs before parseBody; schema-validation cases need a
    // passing auth mock so parseBody is reached.
    vi.mocked(requireAuth).mockResolvedValue({ userId: 'u1' } as never)
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
