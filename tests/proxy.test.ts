import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy } from '../proxy'

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  const req = new Request('http://localhost/anything', { headers })
  return new NextRequest(req)
}

// Next.js 16 renamed middleware.ts -> proxy.ts and the expected
// exported function is `proxy`.
describe('proxy.ts request-id middleware', () => {
  it('generates an x-request-id when the incoming request has none', () => {
    const res = proxy(makeRequest())
    const id = res.headers.get('x-request-id')
    expect(id).toBeTruthy()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('propagates an incoming x-request-id unchanged', () => {
    const res = proxy(makeRequest({ 'x-request-id': 'caller-supplied-id' }))
    expect(res.headers.get('x-request-id')).toBe('caller-supplied-id')
  })
})
