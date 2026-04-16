# Review Feedback — Step 15h
Date: 2026-04-15
Ready for Builder: YES

## Must Fix
None.

## Should Fix
- `src/app/(dashboard)/activity/[id]/page.tsx:141-146` — The synthetic `Request` dance to reuse `getSessionFromRequest` works, but it diverges from how the rest of the dashboard reads sessions. `src/app/(dashboard)/layout.tsx:14-26` uses `cookies()` + `getSessionTokenFromCookie()` + `validateSession()` directly, which is cheaper and reads more naturally in a server component. Recommendation: future pass — align `getSession()` with the layout's pattern so there is one established way to read a session from a server component. Log to BUILD-LOG if not fixed inline; not a blocker because (a) the dashboard layout already redirects unauthenticated users, so this page's `redirect('/login')` is defense-in-depth, and (b) behaviour is equivalent.

## Escalate to Architect
None.

## Cleared

Reviewed the five files listed in the request — `getUserTransferWithEvents` + new user-safe event projection in `src/lib/transfers/queries.ts:104-155`, exports in `src/lib/transfers/index.ts`, the server page `src/app/(dashboard)/activity/[id]/page.tsx`, the client Cancel button, and the 5 new tests.

Checked and confirmed:

- **Ownership**: `findFirst where: { id, userId }` → returns null for non-owners → `notFound()`. No cross-user leak path. Tests at lines 37-46 cover both "not owned" and "non-existent" cases.
- **User-safe projection**: Transfer `select` enumerates allowed columns only; `failureReason`, `payoutProviderRef`, `payoutProvider`, `payidProviderRef`, `payidReference`, `retryCount` are all excluded. Events expose only `id, fromStatus, toStatus, actor, createdAt` — `metadata` and `actorId` omitted. Tests at lines 74-104 explicitly assert these omissions, including after direct `prisma.transfer.update` writing fake values for all the forbidden columns. Recipient projection is also bank-fields-safe (lines 106-118).
- **Cancel gate**: Client `CANCELLABLE = {'CREATED', 'AWAITING_AUD'}` matches `VALID_TRANSITIONS` in `transitions.ts:4-5` exactly (those are the only two states with `CANCELLED` as a valid target). The cancel API at `src/app/api/transfers/[id]/cancel/route.ts` is the real gate — `InvalidTransitionError` → 409, surfaced to the user via `data.error`. `router.refresh()` on success re-fetches the server component so the status pill updates in place.
- **Status copy**: `STATUS_TONE` covers all 13 `TransferStatus` enum values: CREATED, AWAITING_AUD, AUD_RECEIVED, PROCESSING_NGN, NGN_SENT, COMPLETED, EXPIRED, NGN_FAILED, NGN_RETRY, NEEDS_MANUAL, REFUNDED, CANCELLED, FLOAT_INSUFFICIENT. A fallback branch at page.tsx:164-170 handles any future enum additions without crashing.
- **Design tokens**: Uses `DashboardShell`, `colors`, `radius`, `shadow`, `spacing`, `GRADIENT`. Inline hex exceptions (`#b00020`, `#8a6d0a`, `#8a4a0a`) match the existing KolaPrimitives convention for warning/error tones. No raw Tailwind colour classes.
- **Accessibility**: `confirm()` dialog in `CancelTransferButton` matches existing pattern in `account-identity-section.tsx` (Remove email). Acceptable for now; flagging for a future design-system pass along with the rest of the confirm() call sites.
- **Transfer ID display**: Full cuid shown at page.tsx:389 is fine — it's the user's own transfer, under their own auth.
- **Scope**: `git diff --stat` + untracked files show exactly the five files in the brief. No drift.

Signal to Arch: **Step 15h is clear.**
