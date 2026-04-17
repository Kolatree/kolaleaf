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
    recipient: { create: vi.fn(), findMany: vi.fn() },
  },
}))

import { POST } from '@/app/api/v1/recipients/route'
import { requireAuth } from '@/lib/auth/middleware'

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/recipients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/recipients (schema validation)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Auth runs before parseBody; schema-validation cases need a
    // passing auth mock so parseBody is reached.
    vi.mocked(requireAuth).mockResolvedValue({ userId: 'u1' } as never)
  })

  it('returns 400 malformed_json on invalid JSON', async () => {
    const req = new Request('http://localhost/api/v1/recipients', {
      method: 'POST',
      body: 'not-json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 422 when fullName is missing (Zod)', async () => {
    const res = await POST(
      makeRequest({ bankName: 'GT Bank', bankCode: '058', accountNumber: '0690000031' }),
    )
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.fields?.fullName).toBeInstanceOf(Array)
  })

  it('returns 422 when multiple fields are missing (Zod)', async () => {
    const res = await POST(makeRequest({ fullName: 'A' }))
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.fields?.bankName).toBeInstanceOf(Array)
    expect(json.fields?.bankCode).toBeInstanceOf(Array)
    expect(json.fields?.accountNumber).toBeInstanceOf(Array)
  })
})
