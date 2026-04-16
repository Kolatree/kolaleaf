import { describe, it, expect, vi, beforeEach } from 'vitest'

const dispatchMock = vi.fn()

vi.mock('@/lib/queue', () => ({
  getWebhookDispatcher: () => ({ dispatch: dispatchMock }),
}))
vi.mock('@/lib/payments/monoova/verify-signature', () => ({
  verifyMonoovaSignature: vi.fn(),
}))

import { POST } from '@/app/api/webhooks/monoova/route'
import { verifyMonoovaSignature } from '@/lib/payments/monoova/verify-signature'

const verifyMock = vi.mocked(verifyMonoovaSignature)

function makeRequest(body: unknown, signature: string, rawOverride?: string): Request {
  return new Request('http://localhost/api/webhooks/monoova', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-monoova-signature': signature,
    },
    body: rawOverride ?? JSON.stringify(body),
  })
}

describe('POST /api/webhooks/monoova', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.MONOOVA_WEBHOOK_SECRET = 'test-secret'
  })

  it('returns 200 and dispatches when the signature is valid', async () => {
    verifyMock.mockReturnValue(true)
    dispatchMock.mockResolvedValue(undefined)

    const res = await POST(makeRequest({ eventId: '1' }, 'good-sig'))

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.received).toBe(true)
    expect(dispatchMock).toHaveBeenCalledOnce()
    const job = dispatchMock.mock.calls[0][0]
    expect(job.provider).toBe('monoova')
    expect(job.rawBody).toBe(JSON.stringify({ eventId: '1' }))
    expect(job.signature).toBe('good-sig')
    expect(typeof job.receivedAt).toBe('string')
  })

  it('returns 401 and does NOT dispatch when the signature is invalid', async () => {
    verifyMock.mockReturnValue(false)

    const res = await POST(makeRequest({ eventId: '1' }, 'bad-sig'))

    expect(res.status).toBe(401)
    expect(dispatchMock).not.toHaveBeenCalled()
  })

  it('returns 400 when the payload is not JSON', async () => {
    const res = await POST(makeRequest(null, 'sig', 'not json'))
    expect(res.status).toBe(400)
    expect(dispatchMock).not.toHaveBeenCalled()
  })

  it('returns 500 when the dispatcher throws (provider will retry)', async () => {
    verifyMock.mockReturnValue(true)
    dispatchMock.mockRejectedValue(new Error('Redis unreachable'))

    const res = await POST(makeRequest({ eventId: '1' }, 'good-sig'))

    expect(res.status).toBe(500)
  })

  it('returns 500 when the webhook secret is missing', async () => {
    delete process.env.MONOOVA_WEBHOOK_SECRET
    const res = await POST(makeRequest({ eventId: '1' }, 'sig'))
    expect(res.status).toBe(500)
    expect(verifyMock).not.toHaveBeenCalled()
  })
})
