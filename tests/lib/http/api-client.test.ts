import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { API_V1, apiFetch } from '@/lib/http/api-client'

// The client is a thin wrapper around `fetch` that prefixes every path with
// /api/v1. The four cases below pin down the contract the brief specifies.
describe('apiFetch', () => {
  const fetchMock = vi.fn()
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('prefixes a tail path with /api/v1', async () => {
    await apiFetch('auth/login')
    expect(API_V1).toBe('/api/v1')
    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/auth/login')
  })

  it('tolerates a leading slash on the tail path', async () => {
    await apiFetch('/auth/login')
    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/auth/login')
  })

  it('passes through method, headers, and body', async () => {
    await apiFetch('transfers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test': '1' },
      body: JSON.stringify({ amount: 100 }),
    })
    const [, init] = fetchMock.mock.calls[0]
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-Test': '1',
    })
    expect(init.body).toBe(JSON.stringify({ amount: 100 }))
  })

  it('aborts when timeoutMs elapses', async () => {
    // Real fetch path — the mock hangs until the caller's signal aborts,
    // which is exactly what fetchWithTimeout wires up.
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted', 'AbortError'))
        })
      })
    })

    await expect(apiFetch('auth/login', { timeoutMs: 10 })).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})
