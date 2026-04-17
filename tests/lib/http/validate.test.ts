import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { parseBody } from '@/lib/http/validate'

const Body = z.object({
  email: z.string().email(),
  name: z.string().min(1).optional(),
})

function req(body: string | object, init?: RequestInit): Request {
  return new Request('http://localhost/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  })
}

describe('parseBody', () => {
  it('returns { ok: true, data } on a valid body', async () => {
    const result = await parseBody(req({ email: 'a@b.com' }), Body)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.email).toBe('a@b.com')
    }
  })

  it('returns 400 malformed_json on invalid JSON', async () => {
    const result = await parseBody(req('not-json'), Body)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(400)
      const json = (await result.response.json()) as { reason: string }
      expect(json.reason).toBe('malformed_json')
    }
  })

  it('returns 422 validation_failed with fields on a schema failure', async () => {
    const result = await parseBody(req({ email: 'bad' }), Body)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(422)
      const json = (await result.response.json()) as {
        reason: string
        fields: Record<string, string[]>
      }
      expect(json.reason).toBe('validation_failed')
      expect(json.fields.email).toBeInstanceOf(Array)
    }
  })

  it('treats a missing/empty body on POST as malformed_json (400)', async () => {
    const emptyReq = new Request('http://localhost/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '',
    })
    const result = await parseBody(emptyReq, Body)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(400)
      const json = (await result.response.json()) as { reason: string }
      expect(json.reason).toBe('malformed_json')
    }
  })

  it('accepts an empty body {} when schema allows all-optional', async () => {
    const AllOptional = z.object({ note: z.string().optional() })
    const result = await parseBody(req({}), AllOptional)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.note).toBeUndefined()
    }
  })
})
