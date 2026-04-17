import { z } from 'zod'
import { AU_STATES } from '@/lib/auth/constants'

// Shared Zod primitives. Every `_schemas.ts` file in /api/v1 composes
// its request/response shapes from these so format rules (email
// lowercase, AU postcode shape, E.164 phone, etc.) live in one place
// and surface identically across the API + generated OpenAPI spec.

// Email. Lowercased and trimmed so downstream Prisma lookups match
// regardless of how the client cased the input.
export const Email = z
  .string()
  .trim()
  .toLowerCase()
  .email('Please enter a valid email address')

// 6-digit verification code used by the wizard and 2FA flows.
export const SixDigitCode = z
  .string()
  .regex(/^\d{6}$/, 'Code must be 6 digits')

// Password. Min 12 matches the complexity helper in /lib/auth/password.
// Upper bound caps bcrypt cost.
export const Password = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128, 'Password must be at most 128 characters')

// Australian state abbreviation. Values from the single-source list in
// /lib/auth/constants — any change to AU_STATES propagates here.
export const AU_STATE = z.enum(AU_STATES)

// Australian postcode: exactly 4 digits.
export const Postcode = z
  .string()
  .regex(/^\d{4}$/, 'Postcode must be 4 digits')

// E.164 Australian mobile number. Stricter than the generic E.164 shape
// because the app only sends SMS to AU numbers today.
export const Phone = z
  .string()
  .regex(/^\+61\d{9}$/, 'Phone must be in +61XXXXXXXXX format')

// ISO 4217 currency code: three uppercase letters. Used wherever an
// amount is typed with an explicit currency.
export const CurrencyCode = z
  .string()
  .length(3)
  .regex(/^[A-Z]{3}$/, 'Currency code must be 3 uppercase letters')

// Prisma-generated cuid string. Checked as a non-empty string; we
// don't validate the cuid prefix because a stricter check risks
// rejecting valid ids if Prisma moves to cuid2.
export const Cuid = z.string().min(1)

// Amount string. Prisma `Decimal` is stored via its string constructor,
// so the API accepts either a string or a number and normalises to
// string. Negative and NaN rejected; precision preserved by the string
// path. Money flows in this codebase are always non-negative — refunds
// are modeled as separate ledger rows, not sign flips.
export const DecimalString = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const s = String(v).trim()
  if (s.length === 0 || !/^\d+(\.\d+)?$/.test(s)) {
    ctx.addIssue({ code: 'custom', message: 'Must be a non-negative numeric string' })
    return z.NEVER
  }
  return s
})

// Cursor pagination shape reused by list endpoints.
export const PaginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
})

// Shared response wrappers. `SuccessEnvelope` takes an inner schema;
// the generated OpenAPI doc shows the per-route payload nested under
// `data`. Individual routes are free to inline their shape when the
// envelope is not a good fit (auth/me, etc.) — this is a helper, not
// a mandate.
export function SuccessEnvelope<T extends z.ZodTypeAny>(inner: T) {
  return z.object({ data: inner })
}

// Matches the runtime shape of `jsonError(reason, message, status)`.
// Useful as a shared 4xx response schema in OpenAPI.
export const ErrorEnvelope = z.object({
  error: z.string(),
  reason: z.string(),
})

// Matches the runtime shape of `jsonZodError(err)` — the 422 envelope.
export const ValidationErrorEnvelope = z.object({
  error: z.string(),
  reason: z.literal('validation_failed'),
  fields: z.record(z.string(), z.array(z.string())),
})

// Polymorphic identifier shape for auth flows. Wire-format `type` is
// lowercase (REST/OpenAPI convention); callers translate to Prisma's
// uppercase IdentifierType enum via IDENTIFIER_TYPE_TO_PRISMA below.
// Individual route schemas narrow this to the set of types they
// actually handle — advertising google/apple in a route that only
// implements email would be a spec lie.
export const IdentifierTypeValue = z.enum(['email', 'phone', 'apple', 'google'])

export const IdentifierInput = z.discriminatedUnion('type', [
  z.object({ type: z.literal('email'), value: Email }),
  z.object({ type: z.literal('phone'), value: Phone }),
  z.object({ type: z.literal('apple'), value: z.string().min(1) }),
  z.object({ type: z.literal('google'), value: z.string().min(1) }),
])

// Lowercase wire-format -> Prisma uppercase enum. `satisfies` ensures
// the keyset matches IdentifierTypeValue exhaustively — drop a type
// or add one and tsc breaks at this declaration.
export const IDENTIFIER_TYPE_TO_PRISMA = {
  email: 'EMAIL',
  phone: 'PHONE',
  apple: 'APPLE',
  google: 'GOOGLE',
} as const satisfies Record<z.infer<typeof IdentifierTypeValue>, string>
