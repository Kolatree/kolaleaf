import { NextResponse } from 'next/server'
import { z, type ZodError } from 'zod'

// 422 envelope for schema validation failures. Extends `jsonError` by
// adding a `fields` key carrying `z.flattenError(err).fieldErrors`.
// Clients switch on `reason === 'validation_failed'` and render per-
// field copy from `fields[fieldName]`; legacy consumers still get
// `error` + `reason` as on any other non-2xx response.
//
// Status defaults to 422 (Unprocessable Entity). 400 is reserved for
// malformed JSON — see `parseBody` in ./validate.ts.
export function jsonZodError(err: ZodError, status = 422): NextResponse {
  const flat = z.flattenError(err)
  const summary = firstMessage(flat) ?? 'Validation failed'
  return NextResponse.json(
    {
      error: summary,
      reason: 'validation_failed',
      fields: flat.fieldErrors,
    },
    { status },
  )
}

// Pull the first human-readable issue message so the `error` line is
// never empty. Prefer a field-level message (clients usually surface
// the first invalid field); fall back to a formErrors-level message.
function firstMessage(flat: {
  formErrors: string[]
  fieldErrors: Record<string, string[] | undefined>
}): string | undefined {
  for (const key of Object.keys(flat.fieldErrors)) {
    const msgs = flat.fieldErrors[key]
    if (msgs && msgs.length > 0) return msgs[0]
  }
  return flat.formErrors[0]
}
