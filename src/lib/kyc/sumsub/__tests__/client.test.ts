import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SumsubHttpClient } from '../client'
import type { SumsubClient } from '../client'

describe('SumsubHttpClient', () => {
  let client: SumsubClient
  const baseUrl = 'https://api.sumsub.com'
  const appToken = 'test-app-token'
  const secretKey = 'test-secret-key'

  beforeEach(() => {
    client = new SumsubHttpClient(baseUrl, appToken, secretKey, 'basic-kyc-level')
    vi.restoreAllMocks()
  })

  describe('createApplicant', () => {
    it('creates an applicant and returns applicantId', async () => {
      const mockResponse = {
        id: 'applicant-abc-123',
        createdAt: '2025-01-15T10:00:00Z',
      }

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 201 })
      )

      const result = await client.createApplicant({
        userId: 'user-001',
        email: 'test@example.com',
        fullName: 'Test User',
      })

      expect(result.applicantId).toBe('applicant-abc-123')

      const fetchCall = vi.mocked(fetch).mock.calls[0]
      expect(fetchCall[0]).toBe(`${baseUrl}/resources/applicants?levelName=basic-kyc-level`)
      const opts = fetchCall[1] as RequestInit
      expect(opts.method).toBe('POST')
      expect(opts.headers).toEqual(
        expect.objectContaining({
          'Content-Type': 'application/json',
          'X-App-Token': appToken,
        })
      )
      // Verify HMAC signature header is present
      expect((opts.headers as Record<string, string>)['X-App-Access-Sig']).toBeDefined()
      expect((opts.headers as Record<string, string>)['X-App-Access-Ts']).toBeDefined()
    })

    it('throws on non-2xx API response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ description: 'Bad Request' }), { status: 400 })
      )

      await expect(
        client.createApplicant({
          userId: 'user-002',
          email: 'bad@example.com',
          fullName: 'Bad User',
        })
      ).rejects.toThrow('Sumsub API error: 400')
    })

    it('throws on invalid response shape (missing id)', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ unexpected: true }), { status: 201 })
      )

      await expect(
        client.createApplicant({
          userId: 'user-003',
          email: 'broken@example.com',
          fullName: 'Broken Response',
        })
      ).rejects.toThrow('Invalid Sumsub response: missing applicant id')
    })

    it('throws on network failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network timeout'))

      await expect(
        client.createApplicant({
          userId: 'user-004',
          email: 'timeout@example.com',
          fullName: 'Timeout User',
        })
      ).rejects.toThrow('network timeout')
    })
  })

  describe('getAccessToken', () => {
    it('generates an SDK access token for an applicant', async () => {
      const mockResponse = {
        token: 'sdk-token-xyz',
        userId: 'applicant-abc-123',
      }

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 })
      )

      const result = await client.getAccessToken('applicant-abc-123')

      expect(result.token).toBe('sdk-token-xyz')
      expect(result.url).toContain('applicant-abc-123')

      const fetchCall = vi.mocked(fetch).mock.calls[0]
      expect(fetchCall[0]).toBe(
        `${baseUrl}/resources/accessTokens?userId=applicant-abc-123&levelName=basic-kyc-level`
      )
    })

    it('throws on non-2xx API response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ description: 'Not Found' }), { status: 404 })
      )

      await expect(
        client.getAccessToken('unknown-applicant')
      ).rejects.toThrow('Sumsub API error: 404')
    })

    it('throws on invalid response (missing token)', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ noToken: true }), { status: 200 })
      )

      await expect(
        client.getAccessToken('applicant-abc-123')
      ).rejects.toThrow('Invalid Sumsub response: missing access token')
    })
  })

  describe('getApplicantStatus', () => {
    it('returns applicant status with approved review result', async () => {
      const mockResponse = {
        id: 'applicant-abc-123',
        reviewStatus: 'completed',
        reviewResult: {
          reviewAnswer: 'GREEN',
        },
      }

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 })
      )

      const result = await client.getApplicantStatus('applicant-abc-123')

      expect(result.status).toBe('completed')
      expect(result.reviewResult?.reviewAnswer).toBe('GREEN')
      expect(result.reviewResult?.rejectLabels).toBeUndefined()
    })

    it('returns applicant status with rejection reasons', async () => {
      const mockResponse = {
        id: 'applicant-abc-123',
        reviewStatus: 'completed',
        reviewResult: {
          reviewAnswer: 'RED',
          rejectLabels: ['ID_INVALID', 'SELFIE_MISMATCH'],
        },
      }

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 })
      )

      const result = await client.getApplicantStatus('applicant-abc-123')

      expect(result.status).toBe('completed')
      expect(result.reviewResult?.reviewAnswer).toBe('RED')
      expect(result.reviewResult?.rejectLabels).toEqual(['ID_INVALID', 'SELFIE_MISMATCH'])
    })

    it('returns pending status without review result', async () => {
      const mockResponse = {
        id: 'applicant-abc-123',
        reviewStatus: 'pending',
      }

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 })
      )

      const result = await client.getApplicantStatus('applicant-abc-123')

      expect(result.status).toBe('pending')
      expect(result.reviewResult).toBeUndefined()
    })

    it('throws on non-2xx API response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ description: 'Server Error' }), { status: 500 })
      )

      await expect(
        client.getApplicantStatus('applicant-abc-123')
      ).rejects.toThrow('Sumsub API error: 500')
    })
  })

  describe('HMAC signature generation', () => {
    it('includes X-App-Access-Sig and X-App-Access-Ts headers on every request', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'applicant-abc-123' }), { status: 201 })
      )

      await client.createApplicant({
        userId: 'user-sig-test',
        email: 'sig@example.com',
        fullName: 'Sig Test',
      })

      const fetchCall = vi.mocked(fetch).mock.calls[0]
      const headers = fetchCall[1]?.headers as Record<string, string>

      expect(headers['X-App-Access-Sig']).toBeDefined()
      expect(headers['X-App-Access-Ts']).toBeDefined()
      // Timestamp should be a numeric string (unix seconds)
      expect(Number(headers['X-App-Access-Ts'])).toBeGreaterThan(0)
    })
  })
})
