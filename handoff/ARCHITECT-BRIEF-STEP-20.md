# Architect Brief — Step 20: Zod + OpenAPI Contracts
*Written by Arch. Read by Bob (builder) and Richard (reviewer).*

---

## Goal

Introduce Zod request/response schemas at the boundary of every
`/api/v1/*` route, and generate an OpenAPI 3.1 document from those
schemas served at `/api/v1/openapi`. Schemas become the single source
of truth for: route validation, TypeScript request/response types,
OpenAPI spec, and client-side type inference.

This unlocks Step 21 (discriminated-union identifier body) as a
one-schema change, and gives Wave 2 (mobile apps) a machine-readable
contract to generate clients from.

---

## Why now

- `/api/v1` is settled — schemas have a stable surface to adhere to.
- Zod **not installed yet** (green-field; no migration of existing
  validators). 51 routes currently use the same ad-hoc pattern:
  `try { body = await request.json() } catch { 400 }` + per-field
  `typeof x === 'string'` guards. Zod replaces this once.
- `src/lib/http/json-error.ts` already shapes the error envelope —
  Zod errors extend it, no envelope churn for clients.
- No OpenAPI tooling exists yet, so we pick one library and go.

---

## Decisions Locked

| Question | Decision |
|---|---|
| Zod major version | **Zod 3.x (latest stable).** Zod 4 is still beta. |
| OpenAPI generator | **`@asteasolutions/zod-to-openapi`.** Most mature, registers Zod schemas with path/method metadata, emits OpenAPI 3.1. |
| Schema location | **Colocated `_schemas.ts` file alongside each `route.ts`.** Matches App Router colocation. A central registry imports them for OpenAPI generation. |
| Error envelope | **Extend, don't replace.** `jsonError` stays. New `jsonZodError(err, status=422)` calls `err.flatten()` and adds a `fields` key to the envelope. 422 (Unprocessable Entity) for schema failures; 400 reserved for malformed JSON. |
| Response schema enforcement | **Dev-only by default.** In prod it's a noop. Individual routes can opt-in to prod enforcement via flag. Latency cost not worth it for the 95% case. |
| Client-side reuse | **Type-only import.** Client imports `z.infer<>` types, not runtime schemas. Zero bundle-size impact on the frontend. |
| Routes in scope | **All 41 `/api/v1/*` routes.** Webhooks and cron stay out (not `/api/v1`, and webhooks only have signature gates by design — their body-shape validation lives in the BullMQ worker, Step 23). |
| Rollout | **Two internal phases, two commits.** Phase A: tooling + pattern + 5 pilot routes. Phase B: remaining 36 routes. Checkpoint between. |

---

## Architecture

### New modules

#### `src/lib/http/zod-error.ts`
```ts
import { NextResponse } from 'next/server'
import type { ZodError } from 'zod'

// 422 envelope for schema validation failures. Keys:
//   error    human-facing summary
//   reason   'validation_failed' (stable, clients switch on this)
//   fields   z.flatten().fieldErrors shape — keyed by path
export function jsonZodError(err: ZodError, status = 422): NextResponse
```

#### `src/lib/http/validate.ts`
Thin helper that wraps `request.json()` + `schema.safeParse()` and
returns either `{ ok: true, data }` or `{ ok: false, response: NextResponse }`
— so every route looks like:
```ts
const parsed = await parseBody(request, RegisterSendCodeBody)
if (!parsed.ok) return parsed.response
const { email } = parsed.data
```
Contract: malformed JSON → 400 via `jsonError('malformed_json', ...)`.
Schema failure → 422 via `jsonZodError(...)`.

#### `src/lib/openapi/registry.ts`
Central `OpenAPIRegistry` from `@asteasolutions/zod-to-openapi`. Each
route's `_schemas.ts` registers its request/response with the registry
at module-load time. `generateOpenApiDocument()` returns the full
OpenAPI 3.1 JSON.

#### `src/lib/schemas/common.ts`
Shared primitives:
- `Email` — `z.string().email().toLowerCase().trim()`
- `SixDigitCode` — `z.string().regex(/^\d{6}$/)`
- `Password` — `z.string().min(12).max(128)`
- `AU_STATE` — `z.enum([...AU_STATES])` imported from `src/lib/auth/constants.ts`
- `Postcode` — `z.string().regex(/^\d{4}$/)`
- `Phone` — `z.string().regex(/^\+61\d{9}$/)`
- `CurrencyCode` — `z.string().length(3).regex(/^[A-Z]{3}$/)`
- `Ulid` / `Cuid` — whichever Prisma uses for IDs; inspect `schema.prisma`
- `PaginationQuery` — `{ page, limit, cursor }` shape
- `SuccessEnvelope` / `ErrorEnvelope` — standard response wrappers

#### `src/app/api/v1/openapi/route.ts`
```ts
export async function GET() {
  const doc = generateOpenApiDocument({
    openapi: '3.1.0',
    info: { title: 'Kolaleaf API', version: '1' },
    servers: [{ url: '/api/v1' }],
  })
  return NextResponse.json(doc)
}
```
Publicly fetchable; no auth gate. Served at `/api/v1/openapi`. Robots:
disallow via response header.

### Per-route pattern

Every `route.ts` in `src/app/api/v1/**` gets a sibling `_schemas.ts`:

```
src/app/api/v1/auth/send-code/
├── route.ts          # imports from ./_schemas
├── _schemas.ts       # exports RegisterSendCodeBody, RegisterSendCodeResponse
```

`_schemas.ts` both exports the schemas AND registers them with the
OpenAPI registry on import. Registration is idempotent (registry keys
on method+path).

---

## Scope — Phase A vs Phase B

### Phase A — tooling + 5 pilot routes (first commit)

Install Zod + `@asteasolutions/zod-to-openapi`. Build the 4 new modules
above. Migrate **5 representative routes** to exercise the pattern:

| Route | Why it's a good pilot |
|---|---|
| `POST /api/v1/auth/send-code` | Simplest — single field (email) |
| `POST /api/v1/auth/complete-registration` | Complex body — address + password + name |
| `POST /api/v1/transfers` | Money-moving endpoint — regulatory test |
| `GET  /api/v1/account/me` | Response-only schema exercise |
| `POST /api/v1/admin/rates` | Admin path, nested decimals, exotic types |

After Phase A commits, run the OpenAPI endpoint (`GET /api/v1/openapi`)
and visually validate the 5 paths appear correctly in the spec.

### Phase B — remaining 36 routes (second commit)

Roll out the pattern to the remaining 36 v1 routes. If a codemod is
viable (the ad-hoc validation pattern is uniform), write it and run
it; otherwise hand-port. Update the central `src/lib/schemas/index.ts`
barrel to re-export all schemas for client type consumption.

Each route's `_schemas.ts` must include:
- Request body schema (or query schema for GETs)
- Success response schema
- Error response schema (typically just references the shared `ErrorEnvelope`)
- `registry.registerPath(...)` call with method/path/tags/security

---

## Required Tests (TDD-first)

### Phase A tests (new)

1. **`tests/lib/http/zod-error.test.ts`** — 4 cases
   - Returns 422 by default
   - Respects explicit status
   - `fields` key flattens `z.flatten().fieldErrors`
   - `reason` is always `'validation_failed'`

2. **`tests/lib/http/validate.test.ts`** — 5 cases
   - Valid body → `{ ok: true, data }`
   - Malformed JSON → 400 `malformed_json`
   - Schema failure → 422 `validation_failed` + `fields`
   - Missing body on POST → 400
   - Empty body + schema allows optional → 200

3. **`tests/lib/openapi/registry.test.ts`** — 3 cases
   - Registering the same path+method twice is idempotent
   - `generateOpenApiDocument()` returns valid OpenAPI 3.1 (validate via `@stoplight/spectral-core` or shape assertion)
   - Registered path appears under `paths` in the doc

4. **`tests/lib/schemas/common.test.ts`** — 8 cases, one per primitive
   - Email trims + lowercases
   - Password min 12 rejects 11
   - AU_STATE rejects `'XYZ'`, accepts `'NSW'`
   - Postcode rejects `'123'` and `'12345'`
   - Phone rejects missing `+61`
   - CurrencyCode rejects `'usd'` (case), accepts `'USD'`
   - SuccessEnvelope wraps arbitrary data
   - ErrorEnvelope matches `jsonError` shape

5. **Each pilot route's existing test file** adds 3–5 schema-violation cases:
   - Missing required field → 422 with `fields[fieldName]`
   - Wrong type → 422
   - Constraint violation (e.g., email format) → 422

6. **`tests/e2e/openapi-endpoint.test.ts`** — 3 cases
   - `GET /api/v1/openapi` → 200 application/json
   - Response is valid OpenAPI 3.1 (checker)
   - All 5 pilot routes present in `paths`

### Phase B tests

- Each of the remaining 36 routes gets 2–3 additional schema-violation cases added to its existing test file.
- `tests/e2e/openapi-endpoint.test.ts` expanded to assert all 41 paths present.

Expected test delta:
- Phase A: +4 + 5 + 3 + 8 + (~15 pilot route-test cases) + 3 = ~38 new tests
- Phase B: ~36 × 2.5 = ~90 new tests
- Total end-of-Step-20: ~706 + 38 + 90 = **~834 passing**

---

## Verification Checklist (per phase)

### Phase A
- [ ] `npm test -- --run` → ~744 passing
- [ ] `npx tsc --noEmit` → 0 errors
- [ ] `rm -rf .next && npm run build` → success
- [ ] `curl -s localhost:3000/api/v1/openapi | jq '.paths | keys'` shows the 5 pilot paths
- [ ] `curl -iX POST localhost:3000/api/v1/auth/send-code -H 'content-type: application/json' -d '{}'` → 422 with `fields.email = ['Required']`
- [ ] `curl -iX POST localhost:3000/api/v1/auth/send-code -H 'content-type: application/json' -d 'not-json'` → 400 `malformed_json`
- [ ] Commit boundary: `git diff HEAD~1 --stat | tail -1` shows ~15 files changed (pilot routes + infra + tests)

### Phase B
- [ ] `npm test -- --run` → ~834 passing
- [ ] `npx tsc --noEmit` → 0 errors
- [ ] `curl -s localhost:3000/api/v1/openapi | jq '.paths | length'` returns 41
- [ ] Grep: `grep -rn "typeof.*=== 'string'" src/app/api/v1/` → 0 (or only in legit non-body contexts)
- [ ] Commit boundary: separate commit titled `Step 20b: Zod schemas for remaining 36 routes`

---

## Non-goals

- Webhook body schemas — Step 23 (BullMQ worker boundary)
- Cron body schemas — not applicable
- Discriminated-union identifier body — Step 21 is next
- Client-side validation at form boundaries — separate concern
- OpenAPI UI / Swagger UI at `/api/docs` — can add later, not required
- Generating a TypeScript client from the spec — Wave 2's concern

---

## Files Bob will touch (expected)

### Phase A (~15 files)
- **New** (5): `src/lib/http/zod-error.ts`, `src/lib/http/validate.ts`, `src/lib/openapi/registry.ts`, `src/lib/schemas/common.ts`, `src/app/api/v1/openapi/route.ts`
- **New tests** (6): `tests/lib/http/zod-error.test.ts`, `tests/lib/http/validate.test.ts`, `tests/lib/openapi/registry.test.ts`, `tests/lib/schemas/common.test.ts`, `tests/e2e/openapi-endpoint.test.ts`, plus 5 new `_schemas.ts` files under pilot routes
- **Modified** (5 pilot routes): each `route.ts` + its existing test file
- **Modified** (1): `package.json` — add `zod` + `@asteasolutions/zod-to-openapi`

### Phase B (~72 files)
- **New** (36): `_schemas.ts` per remaining route
- **Modified** (36): each remaining `route.ts` + its test
- **Modified** (1): `src/lib/schemas/index.ts` barrel

### Handoff
- `handoff/REVIEW-REQUEST-STEP-20.md` at end of Phase B (single review pass covering both commits)
