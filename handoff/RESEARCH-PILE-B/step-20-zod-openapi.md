# Step 20 — Zod + OpenAPI — research

## Zod presence
- version: not installed (absent from both dependencies and devDependencies in package.json)
- callers: 0 files

## Current validation pattern
- auth/login: manual inline checks — `request.json()` in try/catch, then `!field || typeof field !== 'string'` guards per field. No schema, no reuse.
- admin/rates POST: same manual pattern — body typed as an ad-hoc inline interface literal, field-by-field `=== undefined || === null` checks, no length/range constraints.
- webhooks/monoova: no body shape validation at all — `request.text()` + `JSON.parse()` solely to confirm valid JSON; shape is consumed downstream in the worker. Signature verification is the only gate.

All three patterns share the same structure: `try { body = await request.json() } catch { 400 }` followed by ad-hoc field presence guards. No schema object, no reusable validator, no error message normalisation beyond `jsonError()`.

## OpenAPI tooling
- already present: none (`openapi`, `swagger`, `zod-to-openapi`, `@asteasolutions` — absent from package.json and codebase)

## Existing validation helpers
- `src/lib/http/json-error.ts` — shared error envelope (`jsonError(reason, message, status)`); all routes should continue using this as the error serialiser after Zod migration
- No `src/lib/validation/` directory or equivalent exists

## Route count
- 51 routes

## Open questions for Arch
- Webhook routes validate signature but not body shape; should Zod schemas be applied inside the worker handlers or at the route boundary?
- `json-error.ts` uses a `reason` + `message` pair — should Zod `.flatten()` errors map into this envelope, or introduce a new `fields` key?
- 51 routes is a large surface; should migration be phased by domain (auth → transfers → admin → webhooks) or all-at-once with a codemod?
