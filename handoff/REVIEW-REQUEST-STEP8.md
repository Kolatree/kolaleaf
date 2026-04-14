# Review Request — Step 8: Referral System

**Ready for Review: YES**

## Summary

Built the referral lifecycle service layer. Two source files plus barrel export. Full TDD — 16 tests written first, all passing. The reward lifecycle (PENDING -> ELIGIBLE -> PAID) is fully implemented with self-referral prevention and first-transfer trigger logic.

## Files Changed

### New Files

| File | Lines | Purpose |
|------|-------|---------|
| `src/lib/referrals/referral-service.ts` | 1-89 | Core referral service: getReferralCode, getReferralStats, checkAndTriggerReward, processReward, listReferrals |
| `src/lib/referrals/validation.ts` | 1-45 | Referral code validation: validateReferralCode, canUseReferralCode |
| `src/lib/referrals/index.ts` | 1-13 | Barrel export for all referral functions |
| `src/lib/referrals/__tests__/referral-service.test.ts` | 1-244 | 10 tests covering service functions |
| `src/lib/referrals/__tests__/validation.test.ts` | 1-96 | 6 tests covering validation functions |

### No Existing Files Modified

## Key Decisions

1. **`completedTransfers` in stats counts both ELIGIBLE and PAID** — both states represent a referred user who completed their first transfer. ELIGIBLE just hasn't been paid out yet.

2. **`checkAndTriggerReward` only transitions from PENDING** — if the referral is already ELIGIBLE, PAID, or EXPIRED, it returns null. This prevents re-triggering on subsequent transfers.

3. **`processReward` enforces ELIGIBLE gate** — throws if the referral isn't in ELIGIBLE state. Admin cannot pay a PENDING or already-PAID referral.

4. **Reward amount is a Decimal parameter on processReward** — per brief, not fixed in code. Admin sets it per payout.

5. **Tests use real database** — matches existing test patterns (no mocks). Cleanup respects FK constraints (rates before corridors).

## Test Coverage (16 tests)

### validation.test.ts (6 tests)
- Valid code returns true + referrerId
- Nonexistent code returns false
- Empty string returns false
- Self-referral blocked
- Already-referred user blocked
- Valid referral for unreferred user allowed

### referral-service.test.ts (10 tests)
- getReferralCode returns user's code
- Stats with mixed reward statuses counted correctly
- Stats returns zeros for no referrals
- First completed transfer triggers ELIGIBLE
- Second transfer does not re-trigger
- No referral returns null
- processReward transitions ELIGIBLE to PAID with amount
- processReward throws on non-ELIGIBLE referral
- listReferrals returns user's referrals
- listReferrals returns empty for no referrals

## Verification

```
Test Files  32 passed (32)
Tests       252 passed (252)
```

## Open Questions

None. The brief was unambiguous and all requirements are met.
