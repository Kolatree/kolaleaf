// Shared reason unions. These are the canonical machine-readable
// failure codes returned in `{ error, reason }` response bodies across
// the auth routes. Client code imports the union to get exhaustive
// switch checking; server code uses the strings directly in jsonError().

// Outcomes from verifying a 6-digit email code. Shared between the
// pre-account (PendingEmailVerification) and post-account
// (EmailVerificationToken) flows because the failure modes are
// structurally identical.
export type VerifyCodeReason =
  | "no_token"
  | "expired"
  | "used"
  | "wrong_code"
  | "too_many_attempts";

// /api/auth/complete-registration error reasons. Restricted to the
// codes the route can actually emit after the 2026-05-13 phone-first
// widening + parseBody migration: shape-level failures now flow through
// parseBody → 422 `validation_failed` (carrying field-keyed details),
// so the legacy field-name reasons (invalid_json, missing_email,
// missing_name, missing_address_line1, invalid_address_line2,
// missing_city, invalid_state, invalid_postcode, field_too_long) are
// unreachable and have been removed. What remains is the set the
// business-logic guards in route.ts actually call `fail(...)` with:
// weak_password (password complexity), name_letters_required (NFKC
// zero-width-only name guard), no_pending_verification /
// pending_not_verified / claim_expired (claim state-machine),
// already_registered (race guard / idempotent-retry mismatch), and
// unexpected (catch-all 500). If a new reason is added to the route,
// add it here too — the `Reason` type-binding at the route's fail()
// call sites turns drift into a tsc error.
export type CompleteRegistrationReason =
  | "weak_password"
  | "name_letters_required"
  | "no_pending_verification"
  | "pending_not_verified"
  | "claim_expired"
  | "already_registered"
  | "unexpected";
