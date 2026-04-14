# Review Feedback — Step 3
Date: 2026-04-14
Ready for Builder: YES

## Must Fix

None.

## Should Fix

- `src/lib/transfers/create.ts:95-98` — `sendAmount.toNumber()`, `receiveAmount.toNumber()`, `exchangeRate.toNumber()`, and `fee.toNumber()` convert Decimal.js values to JavaScript floats before passing to Prisma. Prisma accepts `Decimal`, `string`, or `number` for Decimal columns. For a money transmitter, passing through float64 introduces theoretical precision risk. At max corridor values (50000 AUD * 1042.65 rate = ~52M NGN), the result is 16 significant digits -- right at the edge of float64 precision. The DB column rounds to 2 decimal places, so in practice this is safe today, but it is a bad habit. — Pass `sendAmount.toString()` (or the Decimal instance directly) instead of `.toNumber()`. This costs nothing and eliminates the precision concern entirely.

- `src/lib/transfers/create.ts:103-110` — The initial TransferEvent uses `fromStatus: 'CREATED'` and `toStatus: 'CREATED'` because the schema requires `fromStatus` as non-nullable `TransferStatus`. The review request documents this decision. It works, but `CREATED -> CREATED` is semantically odd -- it looks like a self-transition, which the transition tests explicitly assert should be invalid (`transitions.test.ts:97-102`). — Acceptable given the schema constraint. No code change needed. Document in BUILD-LOG that this is intentional and not a real self-transition.

- `tests/lib/transfers/state-machine.test.ts:188-194` — The happy path test comment says "initial + 5 transitions = 6 total events" but the test helper `createTestTransfer` (helpers.ts:69-77) creates an initial event for every test transfer. This means the count of 6 is correct (1 from helper + 5 from transitions), but the comment says "1 initial" when that initial event was created by the test helper, not by the production `createTransfer` function. — Clarify the comment or note that the helper creates the initial event. Minor, not blocking.

- `src/lib/transfers/cancel.ts:39` — On concurrent modification during cancel, the error thrown is `InvalidTransitionError(fromStatus, 'CANCELLED')` rather than `ConcurrentModificationError`. The state-machine.ts correctly throws `ConcurrentModificationError` in the same scenario (line 64). The cancel function should be consistent. — Change the `updated.count === 0` handler to throw `ConcurrentModificationError(transferId)` instead of `InvalidTransitionError`.

## Escalate to Architect

None.

## Cleared

All 13 states have correct transition rules matching the state machine in CLAUDE.md (verified line-by-line against the diagram). Terminal states (COMPLETED, EXPIRED, REFUNDED, CANCELLED) have empty transition arrays -- no outgoing transitions (verified in source and tests). NGN_RETRY checks `retryCount >= 3` before allowing retry, redirecting to NEEDS_MANUAL (verified in source at state-machine.ts:36 and tested at state-machine.test.ts:127-139). Optimistic locking uses `updateMany` with status condition to prevent concurrent transitions (verified in state-machine.ts:58-65 and cancel.ts:33-36). Every transition creates a TransferEvent with correct fromStatus, toStatus, actor, and optional actorId/metadata (verified). Daily limit calculation excludes CANCELLED, EXPIRED, and REFUNDED transfers (verified in create.ts:70). Cursor-based pagination implemented correctly in queries.ts (verified with take+1 pattern). All money amounts use Decimal.js, never raw floats in business logic (verified; the `.toNumber()` at storage boundary is noted as Should Fix). All 51 transfer tests pass. TDD discipline confirmed: 5 test files covering all 6 source files (transitions, state-machine, create, cancel, queries -- errors.ts is pure data classes, tested implicitly). Domain error classes are well-defined with 9 specific error types. The `getTransfer` function correctly scopes by userId for ownership (verified). `getTransferWithEvents` orders events chronologically (verified). FLOAT_INSUFFICIENT state correctly transitions only to PROCESSING_NGN (verified). NEEDS_MANUAL can transition to PROCESSING_NGN (admin retry) or REFUNDED (verified).
