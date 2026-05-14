import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({ userId: 'user-1', session: { id: 'session-1' } })),
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
    $executeRaw: vi.fn(async () => 1),
  },
}))

import { POST } from '@/app/api/v1/analytics/events/route'
import { requireAuth, AuthError } from '@/lib/auth/middleware'
import { prisma } from '@/lib/db/client'
import {
  hashAnalyticsUserId,
  sanitizeAnalyticsProperties,
} from '@/lib/analytics/events'

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/analytics/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: 'kolaleaf_session=tok' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/analytics/events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAuth).mockResolvedValue({
      userId: 'user-1',
      session: { id: 'session-1' } as never,
    })
  })

  it('returns canonical 401 when unauthenticated', async () => {
    vi.mocked(requireAuth).mockImplementationOnce(() => {
      throw new AuthError(401, 'Authentication required')
    })

    const res = await POST(makeRequest({
      event: 'welcome_shown',
      occurredAt: new Date().toISOString(),
    }))

    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({
      error: 'Authentication required',
      reason: 'unauthenticated',
    })
  })

  it('validates known KPI event names', async () => {
    const res = await POST(makeRequest({
      event: 'email_entered',
      occurredAt: new Date().toISOString(),
      properties: {},
    }))

    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toMatchObject({
      reason: 'validation_failed',
    })
  })

  it('records an authenticated event with sanitized properties', async () => {
    const res = await POST(makeRequest({
      event: 'send_screen_viewed',
      occurredAt: '2026-05-14T00:00:00.000Z',
      properties: {
        screen: 'send',
        durationMs: 120,
        recipientName: 'Folasade Adeyemi',
        source: '+61400000000',
      },
    }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ success: true })
    expect(prisma.$executeRaw).toHaveBeenCalledOnce()
    expect(sanitizeAnalyticsProperties({
      screen: 'send',
      durationMs: 120,
      recipientName: 'Folasade Adeyemi',
      source: '+61400000000',
    })).toEqual({ screen: 'send', durationMs: 120 })
  })

  it('hashes users with a stable non-raw identifier', () => {
    const hash = hashAnalyticsUserId('user-1')

    expect(hash).toHaveLength(64)
    expect(hash).not.toBe('user-1')
    expect(hashAnalyticsUserId('user-1')).toBe(hash)
  })
})
