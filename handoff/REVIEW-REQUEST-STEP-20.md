# Review Request — Step 20: Zod + OpenAPI Contracts
*Written by Bob/Arch. Covers both Phase A (3cc886f) and Phase B (ae9b6a4). Read by Richard.*

---

## Summary

Every `/api/v1/*` route now has a colocated `_schemas.ts` file that:
- Validates request bodies (on POST/PATCH/PUT routes with bodies) via `parseBody` → 422 `validation_failed` + `fields` envelope.
- Registers its request/response shape with a central `OpenAPIRegistry`.

`GET /api/v1/openapi` returns a 41-path OpenAPI 3.1 document generated from the same Zod schemas — one source of truth for the Next.js client, future Wave-2 native clients, and internal scripts.

Webhooks, cron, and the `/api/auth/register` 410 stub are untouched (not in `/api/v1`).

**Before Step 20:** 706 tests.
**After Phase A (3cc886f):** 744 tests (+38 for tooling + 5 pilots).
**After Phase B (ae9b6a4):** 792 tests (+48 for remaining 36 routes).

---

## Commits

| Hash | Title |
|---|---|
| `3cc886f` | Step 20a: Zod + OpenAPI — tooling + 5 pilot routes |
| `ae9b6a4` | Step 20b: Zod schemas for remaining 36 routes + barrel |

Both are local-only. `git push` not run (per Arch directive).

---

## Files added (combined)

### Phase A (18)
- `src/lib/http/validate.ts` — `parseBody(req, schema)` helper
- `src/lib/http/zod-error.ts` — 422 `jsonZodError` envelope
- `src/lib/openapi/registry.ts` — singleton `OpenAPIRegistry` + `generateOpenApiDocument()`
- `src/lib/schemas/common.ts` — shared primitives (Email, Password, AU_STATE, Postcode, Phone, CurrencyCode, Cuid, DecimalString, PaginationQuery, SuccessEnvelope, ErrorEnvelope)
- `src/app/api/v1/openapi/route.ts` — `GET /api/v1/openapi` serves generated doc
- 5 pilot `_schemas.ts`: auth/send-code, auth/complete-registration, transfers, account/me, admin/rates
- `tests/lib/http/validate.test.ts`, `tests/lib/http/zod-error.test.ts`, `tests/e2e/openapi-endpoint.test.ts`, plus `tests/app/api/v1/account/me.test.ts`, `tests/app/api/v1/admin/rates.test.ts`, `tests/app/api/v1/transfers/route.test.ts`

### Phase B (17 new _schemas + 1 barrel)
- 36 new `_schemas.ts` files (one per remaining v1 route — 31 new + 5 already committed in A)
- `src/lib/schemas/index.ts` — barrel re-exporting every schema for type-only consumption

## Files modified (combined)

- `src/app/api/v1/openapi/route.ts` — side-effect imports all 41 `_schemas.ts` so the registry is populated regardless of which route fires first
- ~27 `route.ts` files across v1 — body-accepting POSTs refactored to `parseBody(request, Schema)` + `jsonZodError`; bodyless POSTs and GET/DELETE left alone (schema registration handled by openapi/route.ts)
- ~27 paired test files — added 1-3 schema-violation cases each (missing field → 422, wrong type → 422, constraint violation where applicable)
- `tests/e2e/openapi-endpoint.test.ts` — expanded from Phase A's 3-path assertion to 41-path assertion
- `handoff/BUILD-LOG.md` — Arch's in-flight status update (active step → 20, Step 19 marked shipped)

## Files deleted

None.

---

## Design decisions not in brief

1. **Zod 4.3.6, not 3.x (Phase A).** Brief locked Zod 3.x but the pinned OpenAPI generator (`@asteasolutions/zod-to-openapi@8`) requires `zod ^4.0.0`, and Zod 4 moved from beta to the `latest` dist-tag before this step started. Zod 4 API is near-identical at the usage level (`z.object`, `z.enum`, `.safeParse`, `.flatten()` all unchanged).

2. **Side-effect import barrel for OpenAPI registration.** Instead of making every `route.ts` import its `_schemas.ts` (which would be invasive and error-prone for GET/DELETE routes that don't otherwise need the schemas at runtime), `src/app/api/v1/openapi/route.ts` imports ALL 41 `_schemas.ts` at the top as side-effect-only imports. This guarantees the registry is populated the first time the openapi endpoint is hit, and it keeps route handlers clean.

3. **No `parseBody` on bodyless POSTs.** `auth/logout`, `transfers/[id]/cancel`, `admin/transfers/[id]/retry`, `admin/transfers/[id]/refund`, `kyc/initiate` — none of these currently read `request.json()`. They rely on URL params + session cookies. Their `_schemas.ts` registers response types for OpenAPI but the route handlers were not touched. Brief didn't call this out explicitly; Bob's read was that the spirit of the brief is "every route has a typed contract", not "every route calls parseBody".

4. **Final test count 792, not brief's ~834 target.** The 90-test estimate assumed 2-3 schema-violation cases per route across all 41. In practice, GET/DELETE routes and bodyless POSTs don't have meaningful "missing field → 422" cases to add. Coverage landed where it pays (body-accepting endpoints).

---

## Verification

### Test suite
```
Test Files  114 passed (114)
      Tests  792 passed (792)
   Duration  57.34s
```

### Type check
`npx tsc --noEmit` → `TypeScript: No errors found`

### Production build
`rm -rf .next && npm run build` → success, all routes present, 0 errors.

### OpenAPI endpoint (dev server curl)
```
$ curl -s localhost:3000/api/v1/openapi | jq '.paths | keys | length'
41
```
Full path list: all 41 `/api/v1/*` paths (see commit message `ae9b6a4`).
Document size: 56.3 KB. Cache-Control: `public, max-age=60`. `X-Robots-Tag: noindex`.

### Grep gate
`grep -rn "typeof .*=== 'string'" src/app/api/v1/` → 0 results inside route handlers.

---

## Questions for Arch

None. Brief's ambiguities (Zod version, bodyless POSTs, test coverage target) resolved in-flight; see Design Decisions above. If Richard wants any of those revisited, flag in feedback.
