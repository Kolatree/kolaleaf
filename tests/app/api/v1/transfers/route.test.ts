import { describe, it, expect, vi, beforeEach } from 'vitest'

// Route-level tests for POST /api/v1/transfers focused on the new
// Zod validation surface. Business-logic and state-machine coverage
// live in tests/lib/transfers/ and tests/e2e/transfer-*.
vi.mock('@/lib/transfers', () => ({
  createTransfer: vi.fn(),
  listTransfers: vi.fn(),
}))

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireEmailVerified: vi.fn(),
  AuthError: class extends Error {
    statusCode: number
    constructor(statusCode: number, msg: string) {
      super(msg)
      this.name = 'AuthError'
      this.statusCode = statusCode
    }
  },
}))

import { POST } from '@/app/api/v1/transfers/route'
import { requireAuth, requireEmailVerified } from '@/lib/auth/middleware'

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/transfers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/transfers (schema validation)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Auth runs before parseBody; schema-validation cases need passing
    // auth mocks so parseBody is reached.
    vi.mocked(requireEmailVerified).mockResolvedValue(undefined as never)
    vi.mocked(requireAuth).mockResolvedValue({ userId: 'u1' } as never)
  })

  it('returns 400 malformed_json for invalid JSON', async () => {
    const req = new Request('http://localhost/api/v1/transfers', {
      method: 'POST',
      body: 'not json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.reason).toBe('malformed_json')
  })

  it('returns 422 when recipientId is missing (Zod)', async () => {
    const res = await POST(
      postRequest({ corridorId: 'c1', sendAmount: '100', exchangeRate: '1.5' }),
    )
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.reason).toBe('validation_failed')
    expect(json.fields?.recipientId).toBeInstanceOf(Array)
  })

  it('returns 422 when sendAmount is a non-numeric string', async () => {
    const res = await POST(
      postRequest({
        recipientId: 'r1',
        corridorId: 'c1',
        sendAmount: 'not-a-number',
        exchangeRate: '1.5',
      }),
    )
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.fields?.sendAmount).toBeInstanceOf(Array)
  })

  it('returns 422 when required numeric fields are omitted', async () => {
    const res = await POST(postRequest({ recipientId: 'r1', corridorId: 'c1' }))
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.fields?.sendAmount).toBeInstanceOf(Array)
    expect(json.fields?.exchangeRate).toBeInstanceOf(Array)
  })
})
