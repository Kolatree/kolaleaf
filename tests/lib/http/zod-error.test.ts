import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { jsonZodError } from '@/lib/http/zod-error'

// The envelope contract: every schema failure returns
//   { error, reason: 'validation_failed', fields }
// where `fields` is `z.flattenError(err).fieldErrors`. Clients switch
// on `reason`, render per-field copy from `fields`, and fall back to
// `error` for a one-line summary.
describe('jsonZodError', () => {
  function makeErr() {
    const schema = z.object({
      email: z.string().email(),
      age: z.number().int(),
    })
    const parsed = schema.safeParse({ email: 'not-an-email', age: 'x' })
    if (parsed.success) throw new Error('test setup: expected failure')
    return parsed.error
  }

  it('returns 422 by default', async () => {
    const res = jsonZodError(makeErr())
    expect(res.status).toBe(422)
  })

  it('respects an explicit status code', async () => {
    const res = jsonZodError(makeErr(), 400)
    expect(res.status).toBe(400)
  })

  it('flattens field errors into a `fields` key keyed by path', async () => {
    const res = jsonZodError(makeErr())
    const body = (await res.json()) as { fields: Record<string, string[]> }
    expect(body.fields).toBeTruthy()
    expect(body.fields.email).toBeInstanceOf(Array)
    expect(body.fields.email.length).toBeGreaterThan(0)
    expect(body.fields.age).toBeInstanceOf(Array)
  })

  it('always sets reason to "validation_failed"', async () => {
    const res = jsonZodError(makeErr())
    const body = (await res.json()) as { reason: string; error: string }
    expect(body.reason).toBe('validation_failed')
    expect(typeof body.error).toBe('string')
    expect(body.error.length).toBeGreaterThan(0)
  })
})
