# Review Request — Step 3: Transfer State Machine

**Ready for Review: YES**
**Builder: Bob**
**Date: 2026-04-14**

---

## Files Changed

### New Source Files

1. **`src/lib/transfers/transitions.ts`** (27 lines)
   - `VALID_TRANSITIONS` constant: complete map of all 13 states with valid target states
   - `TERMINAL_STATES` array: derived from VALID_TRANSITIONS (COMPLETED, EXPIRED, REFUNDED, CANCELLED)
   - `isValidTransition(from, to)`: boolean lookup

2. **`src/lib/transfers/state-machine.ts`** (75 lines)
   - `transitionTransfer()`: core state machine function
   - Loads transfer, validates transition, applies business rules, updates atomically
   - Prisma `$transaction` for atomicity
   - Optimistic locking via `updateMany` with status condition + optional `expectedStatus` param
   - Business rule: NGN_RETRY with retryCount >= 3 forces NEEDS_MANUAL
   - Sets `completedAt` on COMPLETED transition
   - Creates TransferEvent audit record on every transition

3. **`src/lib/transfers/create.ts`** (96 lines)
   - `createTransfer()`: validates KYC, recipient ownership, corridor, amount range, daily limit
   - Daily limit: sums today's (UTC) non-cancelled/expired/refunded transfers
   - All math via decimal.js — no floats
   - Creates initial TransferEvent (CREATED -> CREATED, actor: USER)

4. **`src/lib/transfers/cancel.ts`** (48 lines)
   - `cancelTransfer()`: owner-only cancellation from CREATED or AWAITING_AUD
   - Optimistic locking, TransferEvent audit

5. **`src/lib/transfers/queries.ts`** (52 lines)
   - `getTransfer(transferId, userId)`: ownership-scoped single fetch
   - `listTransfers(userId, { status?, limit?, cursor? })`: cursor-based pagination
   - `getTransferWithEvents(transferId)`: includes events ordered chronologically

6. **`src/lib/transfers/errors.ts`** (56 lines)
   - 9 domain error classes: InvalidTransitionError, ConcurrentModificationError, TransferNotFoundError, KycNotVerifiedError, InvalidCorridorError, AmountOutOfRangeError, DailyLimitExceededError, RecipientNotOwnedError, NotTransferOwnerError

7. **`src/lib/transfers/index.ts`** (barrel export)

### Test Files

8. **`tests/lib/transfers/transitions.test.ts`** — 16 tests
   - All 13 states mapped, every valid transition verified, every invalid rejected, terminal states, self-transitions

9. **`tests/lib/transfers/state-machine.test.ts`** — 10 tests
   - Valid/invalid transitions, terminal states, not-found, TransferEvent creation, actorId, retry increment, retry >= 3 override, optimistic locking, full happy path walk

10. **`tests/lib/transfers/create.test.ts`** — 9 tests
    - Happy path, initial event, KYC gate, corridor validation, inactive corridor, min/max amount, daily limit, recipient ownership

11. **`tests/lib/transfers/cancel.test.ts`** — 8 tests
    - Cancel from CREATED, AWAITING_AUD, event creation, blocked from AUD_RECEIVED/PROCESSING_NGN/COMPLETED, non-owner rejection, not-found

12. **`tests/lib/transfers/queries.test.ts`** — 8 tests
    - Ownership filtering, pagination with cursor, status filtering, empty results, events ordering, not-found

13. **`tests/lib/transfers/helpers.ts`** — shared test utilities

---

## Test Results

```
5 test files, 51 tests, 51 passed, 0 failed
```

Note: 1 pre-existing failure in `src/lib/auth/__tests__/sessions.test.ts` (Step 2 code, not touched by this step).

---

## Key Decisions

- **Optimistic locking** uses `updateMany` with a `where` clause that includes the current status. If the row was modified between read and write, `count === 0` and we throw `ConcurrentModificationError`. Also supports an explicit `expectedStatus` parameter for callers that hold a stale reference.
- **Retry count >= 3 override**: When transitioning from `NGN_RETRY` to `PROCESSING_NGN` with `retryCount >= 3`, the state machine silently redirects to `NEEDS_MANUAL`. This enforces the 3-retry cap at the domain layer.
- **Daily limit calculation** sums all transfers for the user created today (UTC) that are NOT in CANCELLED, EXPIRED, or REFUNDED status, then adds the proposed amount before comparing to the user's limit.
- **Initial TransferEvent** uses `CREATED -> CREATED` (not `null -> CREATED`) because the Prisma schema requires `fromStatus` as a non-nullable `TransferStatus` enum. The actor is `USER`.

---

## Open Questions

None. All requirements from the brief are implemented and tested.
