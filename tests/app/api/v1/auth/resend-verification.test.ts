import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/client', () => ({
  prisma: {
    userIdentifier: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('@/lib/auth/email-verification', () => ({
  issueVerificationCode: vi.fn(),
}))

import { POST } from '@/app/api/v1/auth/resend-verification/route'
import { prisma } from '@/lib/db/client'
import { issueVerificationCode } from '@/lib/auth/email-verification'

const mockIssue = vi.mocked(issueVerificationCode)
const mockFindUnique = vi.mocked(prisma.userIdentifier.findUnique)

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/auth/resend-verification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/auth/resend-verification (public, email-only)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 when email missing', async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
  })

  it('returns 400 when email is malformed', async () => {
    const res = await POST(makeRequest({ email: 'notanemail' }))
    expect(res.status).toBe(400)
  })

  it('returns 200 with ok:true when email is unknown (no enumeration)', async () => {
    mockFindUnique.mockResolvedValueOnce(null)
    const res = await POST(makeRequest({ email: 'ghost@b.com' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(mockIssue).not.toHaveBeenCalled()
  })

  it('returns 200 with ok:true when email is verified (no code re-sent)', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 'i1',
      userId: 'u1',
      type: 'EMAIL',
      identifier: 'a@b.com',
      verified: true,
      user: { fullName: 'Test' },
    } as never)
    const res = await POST(makeRequest({ email: 'a@b.com' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(mockIssue).not.toHaveBeenCalled()
  })

  it('issues a fresh code for known unverified email', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 'i1',
      userId: 'u1',
      type: 'EMAIL',
      identifier: 'a@b.com',
      verified: false,
      user: { fullName: 'Test User' },
    } as never)
    mockIssue.mockResolvedValueOnce({ ok: true })

    const res = await POST(makeRequest({ email: 'a@b.com' }))
    expect(res.status).toBe(200)
    expect(mockIssue).toHaveBeenCalledWith({
      userId: 'u1',
      email: 'a@b.com',
      recipientName: 'Test User',
    })
  })

  it('still returns 200 if code dispatch throws (no enumeration)', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 'i1',
      userId: 'u1',
      type: 'EMAIL',
      identifier: 'a@b.com',
      verified: false,
      user: { fullName: 'Test' },
    } as never)
    mockIssue.mockRejectedValueOnce(new Error('Resend down'))

    const res = await POST(makeRequest({ email: 'a@b.com' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
  })

  it('normalizes email before lookup', async () => {
    mockFindUnique.mockResolvedValueOnce(null)
    await POST(makeRequest({ email: 'A@B.COM' }))
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { identifier: 'a@b.com' },
      include: { user: true },
    })
  })

  it('returns 400 for invalid JSON', async () => {
    const req = new Request('http://localhost/api/v1/auth/resend-verification', {
      method: 'POST',
      body: 'not json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
