import { describe, it, expect } from 'vitest'
import { GET } from '@/app/api/v1/openapi/route'

// Fetch the OpenAPI document via the route handler — exercises the full
// registry → generator path for all `_schemas.ts` modules that have been
// side-effect-imported by the openapi route.
describe('GET /api/v1/openapi', () => {
  it('returns 200 with application/json', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/application\/json/i)
  })

  it('responds with an OpenAPI 3.1 document shape', async () => {
    const res = await GET()
    const doc = (await res.json()) as {
      openapi: string
      info: { title: string; version: string }
      paths: Record<string, unknown>
    }
    expect(doc.openapi).toBe('3.1.0')
    expect(doc.info.title).toBe('Kolaleaf API')
    expect(typeof doc.paths).toBe('object')
  })

  it('lists all 5 Phase-A pilot routes under paths', async () => {
    const res = await GET()
    const doc = (await res.json()) as { paths: Record<string, unknown> }
    const keys = Object.keys(doc.paths)
    const expected = [
      '/auth/send-code',
      '/auth/complete-registration',
      '/transfers',
      '/account/me',
      '/admin/rates',
    ]
    for (const p of expected) {
      expect(keys).toContain(p)
    }
  })
})
