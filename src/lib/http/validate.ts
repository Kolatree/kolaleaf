import type { NextResponse } from 'next/server'
import type { ZodType } from 'zod'
import { jsonError } from './json-error'
import { jsonZodError } from './zod-error'

// Uniform request-body validator for /api/v1 routes. Every POST handler
// used to open with `try { body = await request.json() } catch { 400 }`
// plus ad-hoc `typeof x === 'string'` guards; `parseBody` collapses
// both paths into one:
//
//   const parsed = await parseBody(request, RegisterBody)
//   if (!parsed.ok) return parsed.response
//   const { email } = parsed.data
//
// Contract:
//   - Malformed / empty JSON → 400 `malformed_json` (via jsonError).
//   - Schema failure → 422 `validation_failed` + `fields` (via jsonZodError).
//   - Success → `{ ok: true, data: T }` typed off the schema.
export type ParseBodyResult<T> =
  | { ok: true; data: T }
  | { ok: false; response: NextResponse }

export async function parseBody<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<ParseBodyResult<T>> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return {
      ok: false,
      response: jsonError('malformed_json', 'Request body is not valid JSON', 400),
    }
  }

  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, response: jsonZodError(parsed.error) }
  }
  return { ok: true, data: parsed.data }
}
