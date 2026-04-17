# Review Feedback — Step 19
*Written by Richard (via critic agent, transcribed by Arch — critic has no Write tool).*

## Verdict
- [x] APPROVE — ready to deploy

## Blocking findings

None.

## Non-blocking findings

### N1: 410 stub migration hint points at pre-v1 path
**Location:** `src/app/api/auth/register/route.ts:13,19`
The `migrate_to` field in the JSON body says `'/api/auth/send-code'` and the `Link` header says `</api/auth/send-code>`. Both should now read `/api/v1/auth/send-code`. A stale client that parses the migration hint and follows it literally will hit a 404 — defeating the stub's purpose.

**Suggested fix:** Update both strings (and the prose in the `error` field) to `/api/v1/...`.

### N2: Comment-only legacy path references (Bob's Decision #3)
**Locations:** `src/app/(dashboard)/account/_components/account-identity-section.tsx:11`, `src/app/(auth)/register/details/page.tsx:21`
Doc comments still reference `/api/account/me` and `/api/auth/complete-registration`. No runtime impact; refresh in a follow-up to avoid confusing future readers.

## Bob's flagged decisions

**1. fetchAdminJson keeps absolute-URL + cookie pattern, sources prefix from `API_V1`.**
Accept. `admin/page.tsx` imports `API_V1` from `api-client.ts` and applies the same defensive `tail` strip as `apiFetch`. One source of truth maintained. Promoting to a named `apiFetchServer` helper can wait until Step 24 touches that code anyway.

**2. `import(variable)` trick in versioning-smoke.test.ts.**
Accept, with a note. The missing-module test asserts `rejects.toBeTruthy()` — any rejection passes, including a Vitest misconfig. `rejects.toThrow(/Cannot find module/)` would be more precise. Acceptable to ship; worth tightening if the smoke suite ever starts giving false positives.

**3. Comment-only legacy path references left as `/api/...`**
Fix preferred (see N1/N2), but not blocking. Batched with the stub's migration-hint fix.

## Positives

- `apiFetch` is correct and minimal. Leading-slash strip at `api-client.ts:21` handles both call forms. `timeoutMs` flows through `ApiFetchInit` into `fetchWithTimeout` cleanly — no behaviour change for existing wizard callers.
- `fetchAdminJson` refactor sources `API_V1` from `api-client.ts` and applies the same defensive tail strip. RSC pattern preserved, single prefix source achieved.
- All 5 spot-checked callers (login, recipients, admin/transfers, wizard hook, admin dashboard) show correct tail paths — no double prefix, no lost query strings, method/headers/body preserved.
- Scope discipline clean: 4 webhooks + 5 crons confirmed untouched. No Zod, no logging, no observability. 410 stub correctly isolated at its legacy path.
- 706/706 tests pass. 0 tsc errors. Build clean. Counts match brief exactly.
- `use-wizard-submit.ts` refactor is particularly clean — `apiFetch` drops in as a direct replacement because `ApiFetchInit extends RequestInit` with the same `timeoutMs` field.
