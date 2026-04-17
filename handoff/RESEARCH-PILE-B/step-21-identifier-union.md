# Step 21 — Discriminated-union identifier body — research

## Routes that accept an identifier

- `POST /api/auth/send-code` → `{ email: string }`
- `POST /api/auth/verify-code` → `{ email: string, code: string }`
- `POST /api/auth/complete-registration` → `{ email, fullName, password, addressLine1, addressLine2, city, state, postcode }` (email is the embedded identifier)
- `POST /api/auth/resend-verification` → `{ email: string }`
- `POST /api/auth/request-password-reset` → `{ email: string }`
- `POST /api/auth/login` → `{ identifier: string, password: string }` — already a generic string field (not typed to union)
- `POST /api/account/phone/add` → `{ phone: string }`
- `POST /api/account/phone/verify` → `{ phone: string }` (pattern match from tldr)
- `POST /api/account/phone/remove` → `{ phone: string }`
- `POST /api/account/change-email` → `{ currentPassword: string, newEmail: string }`

Apple/Google identifier body fields: none found — no routes read `body.appleId` or `body.googleId`.

## Prisma UserIdentifier model

- `type` column: `IdentifierType` enum → values `EMAIL | PHONE | APPLE | GOOGLE`
- value column: `identifier` (String, globally unique)

## Client callers

- `src/app/(auth)/login/page.tsx` → `JSON.stringify({ identifier: email, password })` — passes email string under the key `identifier`
- `src/app/(auth)/register/details/page.tsx` → body includes `{ email, ... }` to `/api/auth/send-code`
- `src/app/(auth)/register/verify/page.tsx` → `{ email, code }` to `/api/auth/verify-code`; resend posts `{ email }`

## Existing IdentifierType type

- Prisma-generated enum at `src/generated/prisma/client` (values: `EMAIL`, `PHONE`, `APPLE`, `GOOGLE`)
- Re-imported in `src/lib/auth/identity.ts` — no standalone application-layer TypeScript union type exists

## Ambiguous multi-identifier bodies

- `/api/auth/login`: body typed as `{ identifier?: string }` — one field but semantically accepts email, phone, or future OAuth handles. No union enforced; value normalised via `.trim().toLowerCase()` only.
- No route was found that accepts both `email?` and `phone?` simultaneously in one shape.

## Open questions for Arch

- Login uses `{ identifier }` (already generic) — should it adopt the discriminated union `{ type, value }` or stay as-is since it already accepts any string?
- Apple and Google identifier routes don't exist yet — will they be new routes or will existing routes be extended?
- `verify-code` and `send-code` are email-only by design; should they accept `{ type: 'email', value }` or stay email-specific and be left out of the union migration?
- `complete-registration` embeds email as one of many profile fields — does the union shape apply here, or only to pure identifier-lookup routes?
