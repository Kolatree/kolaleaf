import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/webhooks/monoova/route'

vi.mock('@/lib/payments/monoova/webhook', () => ({
  handleMonoovaWebhook: vi.fn(),
}))

import { handleMonoovaWebhook } from '@/lib/payments/monoova/webhook'

const mockHandler = vi.mocked(handleMonoovaWebhook)

function makeWebhookRequest(body: unknown, signature: string): Request {
  return new Request('http://localhost/api/webhooks/monoova', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-monoova-signature': signature,
    },
    body: JSON.stringify(body),
  })
}

describe('POST /api/webhooks/monoova', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 200 on successful processing', async () => {
    mockHandler.mockResolvedValue(undefined)
    const res = await POST(makeWebhookRequest({ eventId: '1' }, 'sig123'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.received).toBe(true)
    expect(mockHandler).toHaveBeenCalledOnce()
  })

  it('returns 401 for invalid signature', async () => {
    mockHandler.mockRejectedValue(new Error('Invalid webhook signature'))
    const res = await POST(makeWebhookRequest({ eventId: '1' }, 'bad'))
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid payload', async () => {
    const req = new Request('http://localhost/api/webhooks/monoova', {
      method: 'POST',
      headers: { 'x-monoova-signature': 'sig' },
      body: 'not json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('passes raw body string to handler for signature verification', async () => {
    mockHandler.mockResolvedValue(undefined)
    const body = { eventId: '42', eventType: 'payment' }
    await POST(makeWebhookRequest(body, 'mysig'))
    expect(mockHandler).toHaveBeenCalledWith(JSON.stringify(body), 'mysig')
  })
})
