# Architect Brief — Step 21: Discriminated-Union Identifier Body
*Written by Arch. Read by Bob (builder) and Richard (reviewer).*

---

## Goal

Introduce a Zod discriminated-union primitive `IdentifierInput` that
types a polymorphic identifier on request bodies as
`{ type: 'email' | 'phone' | 'apple' | 'google', value: string }`,
and migrate the one in-repo route that currently carries a bare
`identifier: string` (`/api/auth/login`) to the typed shape.

This is the last piece of the Step-20 Zod/OpenAPI foundation — it
closes the open question the research scout flagged about
`/auth/login` being typed as `z.string()` without discrimination. It
also pre-wires the schema shape for future Apple / Google OAuth
routes without expanding their scope here.

---

## Decisions Locked

| Question | Decision |
|---|---|
| Wire-format casing for `type` | **lowercase** (`email`, `phone`, `apple`, `google`). Mapped to Prisma's uppercase `IdentifierType` internally via a lookup. REST/OpenAPI convention, easier for future client SDKs. |
| Apply to wizard routes? | **No.** `send-code`, `verify-code`, `complete-registration`, `resend-verification`, `request-password-reset`, `reset-password`, `verify-email` all take a bare `email` today by design. Adding discrimination there is ceremony without a caller. |
| Apply to phone routes? | **No.** Phone routes `account/phone/{add,verify,remove}` take a bare `phone` — scope tight, no polymorphism. |
| Apply to `/auth/login` | **Yes.** This is the only polymorphic body in the repo today. Flip from `{identifier, password}` to `{type: 'email', value, password}`. |
| Backward compat via `z.union([LegacyLogin, NewLogin])` | **No.** No external clients consume the API yet (pre-launch). Atomic flip. |
| Apple / Google route scaffolds in this step | **No.** Out of scope — the primitive is ready; the routes land when OAuth ships. |

---

## Architecture

### New primitive in `src/lib/schemas/common.ts`

```ts
export const IdentifierTypeValue = z.enum(['email', 'phone', 'apple', 'google'])

// Discriminated union. Each variant constrains `value` to its own
// format, so `{type: 'email', value: 'not-an-email'}` fails with a
// field-specific error rather than a generic string mismatch.
export const IdentifierInput = z.discriminatedUnion('type', [
  z.object({ type: z.literal('email'), value: Email }),
  z.object({ type: z.literal('phone'), value: Phone }),
  z.object({ type: z.literal('apple'), value: z.string().min(1) }),
  z.object({ type: z.literal('google'), value: z.string().min(1) }),
])

// Lookup to convert the wire-format lowercase `type` to the Prisma
// IdentifierType enum (uppercase). Co-located so there's one
// mapping site.
export const IDENTIFIER_TYPE_TO_PRISMA = {
  email: 'EMAIL',
  phone: 'PHONE',
  apple: 'APPLE',
  google: 'GOOGLE',
} as const satisfies Record<z.infer<typeof IdentifierTypeValue>, string>
```

### `/api/v1/auth/login` contract change

**Before:**
```ts
{ identifier: string, password: string }
```

**After:**
```ts
{ type: 'email' | 'phone' | 'apple' | 'google', value: string, password: string }
```

Route body handling:
```ts
const parsed = await parseBody(request, LoginBody)
if (!parsed.ok) return parsed.response
const { identifier, password } = parsed.data
// identifier is { type, value } after discriminated-union parse
const prismaType = IDENTIFIER_TYPE_TO_PRISMA[identifier.type]
// existing lookup uses `identifier: value, type: prismaType`
```

Login today is email-only in practice, but by the time Apple/Google
routes land they'll just call `signIn({type: 'apple', value: tokenId})`
against this same contract.

---

## Required Tests

1. **`tests/lib/schemas/common.test.ts`** — expand existing suite with 4 cases:
   - `IdentifierInput.parse({type: 'email', value: 'a@b.com'})` → ok
   - `IdentifierInput.parse({type: 'email', value: 'not-email'})` → throws
   - `IdentifierInput.parse({type: 'phone', value: '+61412345678'})` → ok
   - `IdentifierInput.parse({type: 'bogus', value: 'x'})` → throws (invalid discriminator)

2. **`tests/app/api/v1/auth/login.test.ts`** — add 3 schema-violation cases:
   - Missing `type` → 422 with `fields.type` (discriminator)
   - `type: 'email'` + malformed value → 422 with `fields.value`
   - Legacy `{identifier: ...}` body shape → 422 (type missing)

3. **Existing login happy-path test** updates to the new body shape.

Expected delta: +7 new cases, ~2 existing updates.

---

## Verification Checklist

- [ ] `npm test -- --run` → previous + 7 passing
- [ ] `npx tsc --noEmit` → 0 errors
- [ ] `rm -rf .next && npm run build` → success
- [ ] Local curl smoke:
  ```
  curl -iX POST localhost:3000/api/v1/auth/login \
    -H 'content-type: application/json' \
    -d '{"type":"email","value":"x@y.com","password":"..."}'
  ```
  → 200 or 401 (not 422)
- [ ] OpenAPI doc at `/api/v1/openapi` shows the new `LoginBody` shape
  with `oneOf` discriminator on `type`

---

## Files Bob will touch (expected ~5)

- **Modified** (3): `src/lib/schemas/common.ts` (add `IdentifierInput`, `IDENTIFIER_TYPE_TO_PRISMA`, `IdentifierTypeValue`); `src/app/api/v1/auth/login/_schemas.ts` (use the new primitive); `src/app/api/v1/auth/login/route.ts` (consume `identifier.type` + `identifier.value`)
- **Modified** (2 tests): `tests/lib/schemas/common.test.ts` (4 union cases); `tests/app/api/v1/auth/login.test.ts` (3 new + body-shape updates)
- **Client callers** (1): `src/app/(auth)/login/page.tsx` — update the POST body shape

One local commit: `Step 21: discriminated-union identifier body on /auth/login`. No push.
