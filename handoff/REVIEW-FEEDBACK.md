# Review Feedback — Step 18 (verify-first registration)
*Written by Richard. Read by Arch; actioned by Arch directly.*

**Verdict:** REQUEST_CHANGES (2 Critical, 2 Major, 2 Nit)

---

## Critical (must fix before deploy)

### C1 — Rate limit is permanently broken
`src/lib/auth/pending-email-verification.ts:46-52`

`count({ where: { email, createdAt >= now-1h }})` against `PendingEmailVerification` can never reach 5. `email` is `@unique` and issuance uses `upsert` — so there is exactly one row per email and its `createdAt` is set at first insert and never updated. Count returns 0 or 1 forever. An attacker can call `/send-code` for any email at unlimited rate, rotating codes out of the real user's inbox. Existing unit test passes only because it mocks `count` returning 5 directly — it does not test the production query.

**Fix:** Add `sendCount Int @default(0)` + `sendWindowStart DateTime @default(now())` to the model. Check-then-upsert:
- Fetch the row.
- If `sendWindowStart` within last hour and `sendCount >= 5` → rate_limited.
- Else upsert with `sendCount = (within ? +1 : 1)` and `sendWindowStart = (within ? unchanged : now)`.
- New unit test proves the production query shape — not a mocked count.

### C2 — Duplicate `SESSION_EXPIRY_MINUTES = 15` constant
`src/app/api/auth/complete-registration/route.ts:30` + `src/lib/auth/sessions.ts:4`

`createSession` can't be used inside `prisma.$transaction(async (tx) => ...)` because it calls `prisma.session.create` (not `tx.session.create`). Bob correctly inlined the session creation — but also inlined the TTL. Changing expiry in `sessions.ts` won't affect registration.

**Fix:** `export SESSION_EXPIRY_MINUTES` from `sessions.ts`; import it in the route. Inlined `tx.session.create(...)` stays; only the constant is deduplicated.

---

## Major (fix before wave closes)

### M1 — Audit event name inconsistency: `'REGISTRATION'` vs `'REGISTER'`
`src/app/api/auth/complete-registration/route.ts:172`

Deleted legacy `register.ts` wrote `event: 'REGISTER'`. New route writes `'REGISTRATION'`. AUSTRAC audit queries filtering on the old string silently miss every new account. Change to `'REGISTER'` + update matching test.

### M2 — Burn-on-Nth-attempt uses two sequential writes
`src/lib/auth/pending-email-verification.ts:144-158`

Not exploitable (Richard analysed the race and confirmed the cap still enforces) but fragile. Single atomic update is cleaner:
```ts
const willHit = row.attempts + 1 >= PENDING_CODE_MAX_ATTEMPTS
await prisma.pendingEmailVerification.update({
  where: { id: row.id },
  data: {
    attempts: { increment: 1 },
    ...(willHit && { expiresAt: new Date(now.getTime() - 1) }),
  },
})
```

### M3 — Design Call #6 missing type guard (latent OAuth data-destruction)
`src/app/api/auth/complete-registration/route.ts:117-143`

Stale-cleanup deletes `existing` unconditionally after the 409 guard. If a future GOOGLE/APPLE identifier stored the email string as its `identifier`, it would be silently deleted. Not exploitable today. Add `existing.type === 'EMAIL'` to the delete check, treat non-EMAIL collisions as 409.

---

## Minor / Nit

### N1 — Vacuous `addressLine2` null assertion
`tests/app/api/auth/complete-registration.test.ts:249`

`expect(a == null || a === '').toBe(true)` — `=== ''` arm unreachable (route normalises to `null` before write). Replace with `expect(call.data.addressLine2).toBeNull()`.

### N2 — Intent comment missing on discarded result
`src/app/api/auth/send-code/route.ts:50`

`await issuePendingEmailCode(...)` return value deliberately ignored per enumeration-proof spec. Add a comment so future readers don't "fix" it.

---

## Richard's Open Questions

**Q1 — Resend failure surfacing.** When `sendEmail` throws, route returns 200 and user sits at verify step with no code arriving. Acceptable as "best effort" for v1? **Arch: yes, log-and-retry-queue is filed as a Known Gap.**

**Q2 — Rate limit implementation choice.** Columns on existing row vs separate send-log table. **Arch: columns — simpler migration, no new indirection.**

---

## Resolution Plan

Arch applies all fixes directly (localized; faster than a second Bob round). After fixes: re-run validation, apply migration to prod, commit, push, smoke-test.
