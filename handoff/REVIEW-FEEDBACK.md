# Review Feedback — Step 16
Date: 2026-04-16
Ready for Builder: YES

## Must Fix

None.

## Should Fix

- `src/lib/payments/payout/flutterwave.ts:206-208` — the catch-all
  `if (err instanceof PayoutError && !err.retryable)` swallows every
  non-retryable `PayoutError` subclass into `AccountNotFoundError`. At this
  endpoint (`/accounts/resolve`) the only realistic producer of a non-retryable
  PayoutError via `withRetry` is a provider permanent error, so in practice
  this is fine today — but the moment anyone throws `InvalidBankError` or a
  future non-retryable subclass from inside the resolve call path, the user
  will see "Account not found" when the real cause is something else. Narrow
  the catch to exactly the classes you want to remap, or drop this branch
  entirely since line 203-205 already handles `ProviderPermanentError` and
  lines 212-219 handle provider `status: "error"` / missing `account_name`.
  You called this out yourself in Open Question #5. Agreed — tighten it.

- `src/app/api/recipients/resolve/route.ts:84` — `bankCode.trim()` is passed
  to `resolveAccount`, but the idempotency key inside the adapter hashes the
  un-normalised `bankCode`. If a client (today: only our UI, but the route is
  a public-facing API) sends `" 058 "`, the call uses `"058"` but the hash is
  over `" 058 "`. Not a correctness bug (different inputs → different keys is
  valid) but it does mean two semantically-identical calls get different
  idempotency keys. Either trim before hashing in the adapter, or don't trim
  in the route. Not blocking.

- `src/app/api/recipients/resolve/route.ts:35` — the in-memory `rateLimitMap`
  is process-global and never evicted. On a long-lived worker this will grow
  without bound as new userIds appear. Add a periodic sweep, or switch to
  `Map`-with-TTL / an LRU when Redis lands. Fine for launch — log in
  BUILD-LOG as a known-gap to revisit with the Redis rate-limit work.

- Minor: `src/lib/payments/payout/flutterwave.ts:102` — `devListBanksLogged`
  is module-scoped. In test runs where multiple `FlutterwaveProvider`
  instances are created in sequence, only the first will log. This is the
  intended "once per process" behaviour but it does mean the test at
  flutterwave-resolve.test.ts line 17 passes even if the log is suppressed.
  Harmless, but worth a comment saying "intentionally module-scoped."

## Escalate to Architect

None. The open questions Bob flagged are code-level and resolved above.

## Cleared

Step 16 reviewed across 11 files + 3 test files (21 new tests, all green;
628/628 overall). Verified: lazy `createFlutterwaveProvider()` factory
(import does not validate env — matches 15l pattern); SHA-256 idempotency
key hashes raw `bankCode:accountNumber` string, not JSON; resolve route
auth-gates and rate-limits correctly per-userId (test at resolve.test.ts
line 133-152 confirms 21st call returns 429); resolved-name verbatim
preservation (flutterwave-resolve.test.ts line 129-147 asserts the
whitespace-padded name is returned literally); UI submit is disabled via
`disabled={saving || resolveState.kind !== 'resolved'}` and bound to the
resolve state machine; `resolveSeqRef` guard correctly drops stale 404s
arriving after a newer 200; `POST /api/recipients` server route is not in
the modified set (git status confirms); dev mock uses `slice(-4)` for the
last 4 digits; bank cache is keyed per country and the cache-hit path is
exercised by the 24h cache test.

Step 16 is clear.
