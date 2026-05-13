import { describe, it, expect, vi, beforeEach } from 'vitest'

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
    authEvent: {
      findMany: vi.fn(async () => []),
      create: vi.fn(async () => ({})),
    },
  },
}))

vi.mock('@/lib/auth/audit', () => ({
  logAuthEvent: vi.fn(async () => undefined),
}))

import { POST } from '@/app/api/v1/auth/device-attestation/route'
import { requireAuth, AuthError } from '@/lib/auth/middleware'
import { prisma } from '@/lib/db/client'
import { logAuthEvent } from '@/lib/auth/audit'
import { hashAppAttestKeyId } from '@/lib/auth/device-attestation'

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/auth/device-attestation', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: 'kolaleaf_session=tok',
      'user-agent': 'Kolaleaf iOS',
    },
    body: JSON.stringify(body),
  })
}

function supportedBody(keyId = 'app-attest-key-id-123456') {
  return {
    supported: true,
    appAttestKeyId: keyId,
    environment: 'development',
    bundleId: 'com.kolaleaf.app',
    osVersion: '18.6',
    deviceModel: 'iPhone',
  }
}

describe('POST /api/v1/auth/device-attestation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAuth).mockResolvedValue({
      userId: 'user-1',
      session: { id: 'session-1' } as never,
    })
    vi.mocked(prisma.authEvent.findMany).mockResolvedValue([])
  })

  it('returns canonical 401 when session is missing', async () => {
    vi.mocked(requireAuth).mockImplementationOnce(() => {
      throw new AuthError(401, 'Authentication required')
    })

    const res = await POST(makeRequest(supportedBody()))

    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({
      error: 'Authentication required',
      reason: 'unauthenticated',
    })
  })

  it('returns 422 when supported devices omit appAttestKeyId', async () => {
    const res = await POST(makeRequest({
      supported: true,
      environment: 'development',
      bundleId: 'com.kolaleaf.app',
    }))

    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.reason).toBe('validation_failed')
  })

  it('records first supported device without alerting', async () => {
    const res = await POST(makeRequest(supportedBody('first-device-key-123456')))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      registered: true,
      isNewDevice: true,
      shouldAlert: false,
    })
    expect(logAuthEvent).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      event: 'DEVICE_ATTESTED',
      metadata: expect.objectContaining({
        appAttestKeyHash: hashAppAttestKeyId('first-device-key-123456'),
      }),
    }))
  })

  it('does not alert for a returning known device', async () => {
    vi.mocked(prisma.authEvent.findMany).mockResolvedValueOnce([
      { metadata: { appAttestKeyHash: hashAppAttestKeyId('known-device-key-123456') } },
    ] as never)

    const res = await POST(makeRequest(supportedBody('known-device-key-123456')))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      registered: true,
      isNewDevice: false,
      shouldAlert: false,
    })
    expect(logAuthEvent).not.toHaveBeenCalledWith(expect.objectContaining({
      event: 'NEW_DEVICE_LOGIN_ALERTED',
    }))
  })

  it('alerts when a second supported device appears', async () => {
    vi.mocked(prisma.authEvent.findMany).mockResolvedValueOnce([
      { metadata: { appAttestKeyHash: hashAppAttestKeyId('old-device-key-123456') } },
    ] as never)

    const res = await POST(makeRequest(supportedBody('new-device-key-123456')))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      registered: true,
      isNewDevice: true,
      shouldAlert: true,
      alert: {
        title: 'New device signed in',
      },
    })
    expect(logAuthEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: 'NEW_DEVICE_LOGIN_ALERTED',
    }))
  })

  it('audits unsupported devices without registering a persistent key', async () => {
    const res = await POST(makeRequest({
      supported: false,
      environment: 'unsupported',
      bundleId: 'com.kolaleaf.app',
      osVersion: '18.6',
      deviceModel: 'Simulator',
    }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      registered: false,
      isNewDevice: false,
      shouldAlert: false,
    })
    expect(prisma.authEvent.findMany).not.toHaveBeenCalled()
    expect(logAuthEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: 'DEVICE_ATTESTATION_UNSUPPORTED',
    }))
  })
})
