import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { requireAuth, AuthError } from "@/lib/auth/middleware";
import { parseBody } from "@/lib/http/validate";
import { jsonError } from "@/lib/http/json-error";
import { log } from "@/lib/obs/logger";
import { logAuthEvent } from "@/lib/auth/audit";
import { extractRequestContext } from "@/lib/security/request-context";
import { checkAccountWriteRateLimit } from "@/lib/auth/account-write-rate-limit";
import {
  ACCOUNT_ME_SELECT,
  buildAccountMePayload,
  loadAccountIdentities,
  loadAccountMe,
  type SelectedAccountUser,
} from "@/lib/account/loadAccountMe";
import { PatchMeBody, type PatchMeBodyInput } from "./_schemas";

// /api/v1/account/me — GET (read summary) and PATCH (Phase 3 / U29+U30
// PostKYC partial-update path).
//
// Phase 3 extension:
//   - GET now also exposes `displayName`, the AU address columns,
//     and `kycStatus`. Existing fields untouched.
//   - PATCH writes `displayName` and AU address columns. DOB and
//     `fullName` are NOT mutable here (KYC-verified; mutation would
//     break the AML/CTF audit chain).
//   - PATCH writes an immutable `ACCOUNT_PROFILE_UPDATED` AuthEvent
//     for AUSTRAC's 7-year retention requirement (Pino logs only
//     persist 30-90d on Railway). Field NAMES + before/after values
//     for AML-relevant columns (address, displayName) are stored
//     inside the AuthEvent.metadata Json column — that table exists
//     specifically for this retention need.
//
// CA-005 / OO-002: `loadAccountMe` + `maskPhone` were extracted into
// `@/lib/account/loadAccountMe` and `@/lib/format/maskPhone` so this
// file is purely about HTTP concerns (auth / rate-limit / transaction
// orchestration / error envelopes). The data-loading + payload-building
// logic is now testable in isolation and reusable from any future
// server-side surface.
//
// 15g context (preserved): primary EMAIL identifier + secondary email
// list, masked phone, 2FA flags. Zero password / 2FA secret / backup-
// code hash exposure.

export async function GET(request: Request) {
  try {
    const { userId } = await requireAuth(request);
    const payload = await loadAccountMe(userId);
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof AuthError) {
      return jsonError("unauthorized", error.message, error.statusCode);
    }
    log("error", "account.me.failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError("server_error", "Server error", 500);
  }
}

// PATCH /api/v1/account/me — partial update for Phase 3 PostKYC flow.
//
// Idempotent: identical bodies produce the same row state. Empty
// strings on the wire are normalised to NULL by `NullableIdentityString`
// in `_schemas.ts`, which keeps the column-NULL contract uniform.
//
// Order of operations (security/correctness):
//   1. requireAuth — never leak the 422 schema shape to anonymous
//      callers.
//   2. parseBody — Zod schema validates + sanitizes (NFKC + bidi
//      strip). Schema is `.strict().partial()` so an unknown key
//      (e.g. `admin: true`, `kycStatus: 'VERIFIED'`) returns 422
//      `validation_failed` instead of silently passing through.
//   3. ADV2-3: per-user write rate limit (20/day) is consumed AFTER
//      schema validation passes, NOT before. Without this, 20
//      schema-rejected requests would exhaust the legitimate user's
//      quota: a single attacker with a stolen session could push 20
//      malformed bodies in one second and lock the account out of
//      its single legitimate update for the day. The rate limit is
//      meant to cap successful writes (the AML-relevant audit
//      surface), not validation failures (which are pre-side-effect
//      and produce no auditable change).
//   4. ATOMIC: `prisma.$transaction` wrapping (a) before-row read,
//      (b) `tx.user.update`, and (c) `logAuthEvent(..., tx)`. If the
//      AuthEvent insert fails, the user mutation rolls back. AUSTRAC
//      requires every change to a KYC-bound regulated record to be
//      recorded in an immutable retained store — without the
//      transaction, a transient AuthEvent insert failure (connection
//      blip, statement timeout) would leave the User row mutated with
//      no audit row. (ADV-1)
//   5. Identity reads (phone + email identifiers) run AFTER the tx
//      commits — they're read-only and don't affect atomicity, so
//      keeping them outside the tx shrinks the lock window.
export async function PATCH(request: Request) {
  try {
    // (1) Auth before parseBody so a 422 doesn't leak the body shape
    // to an unauthenticated caller — same pattern as
    // /account/change-email.
    const { userId } = await requireAuth(request);

    // (2) Schema-level validation + sanitization. `.strict().partial()`
    // rejects unknown keys with 422 `validation_failed`. (ADV2-1)
    // Runs BEFORE the rate limit so a malformed body can't burn the
    // user's daily write quota. (ADV2-3)
    const parsed = await parseBody(request, PatchMeBody);
    if (!parsed.ok) return parsed.response;
    const data = parsed.data;

    // (3) CA-004: typed projection from the validated body to a
    // `Prisma.UserUpdateInput`. The compiler now enforces that every
    // wire-level field present in `PatchMeBody` maps to an actual
    // column on the User model — drift between the schema and the
    // table surfaces at compile time, not as a Prisma runtime crash
    // on the deploy. The earlier `Record<string, unknown>` filter
    // loop accepted any string key.
    const update: Prisma.UserUpdateInput = {};
    if (data.displayName !== undefined) update.displayName = data.displayName;
    if (data.addressLine1 !== undefined)
      update.addressLine1 = data.addressLine1;
    if (data.addressLine2 !== undefined)
      update.addressLine2 = data.addressLine2;
    if (data.city !== undefined) update.city = data.city;
    if (data.state !== undefined) update.state = data.state;
    if (data.postcode !== undefined) update.postcode = data.postcode;
    if (data.country !== undefined) update.country = data.country;

    // Single source of truth for which keys we actually intend to write.
    // Derived from `update` (not `data`) so the audit log + structured
    // log can never drift from what Prisma was asked to mutate.
    const fields = Object.keys(update) as Array<keyof PatchMeBodyInput>;

    // (4) ADV2-3: rate-limit AFTER schema validation. A 422 never
    // consumes a token, so malformed bodies cannot exhaust the daily
    // cap on real writes.
    const limit = await checkAccountWriteRateLimit("account-me", userId);
    if (!limit.allowed) {
      const retryAfter = Math.ceil(limit.retryAfterMs / 1000);
      return jsonError(
        "rate_limited",
        "Too many account updates. Try again later.",
        429,
        { "Retry-After": String(retryAfter) },
      );
    }

    const ip = extractRequestContext(request).ip;

    // (5) Atomic User mutation + AuthEvent emission. If the AuthEvent
    // write fails, the User update rolls back — the AML/CTF audit
    // chain never has a gap. (ADV-1)
    const afterRow = await prisma.$transaction(async (tx) => {
      // Capture before-values for AML-relevant fields inside the tx
      // so the diff reflects the state we're about to mutate (not a
      // racy read from before the row lock).
      const before = (await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: ACCOUNT_ME_SELECT,
      })) as SelectedAccountUser;

      // Single update with explicit select. One round-trip; no
      // GET-after-PATCH race; no `SELECT *` migration-ordering risk.
      let after: SelectedAccountUser = before;
      if (fields.length > 0) {
        after = (await tx.user.update({
          where: { id: userId },
          data: update,
          select: ACCOUNT_ME_SELECT,
        })) as SelectedAccountUser;
      }

      // AuthEvent for AUSTRAC retention. Field NAMES + before/after
      // for AML-relevant columns. Passing `tx` as the writer keeps
      // the audit insert in the same transaction — the entire write
      // (User mutation + AuthEvent row) is atomic.
      const fieldChanges: Record<string, { before: unknown; after: unknown }> =
        {};
      for (const key of fields) {
        const k = key as keyof SelectedAccountUser;
        fieldChanges[key] = {
          before: before[k] ?? null,
          after: after[k] ?? null,
        };
      }
      await logAuthEvent(
        {
          userId,
          event: "ACCOUNT_PROFILE_UPDATED",
          ip,
          metadata: {
            fields,
            // Storing before/after for AML-relevant fields inside
            // AuthEvent is intentional: this table is the 7-year
            // retention sink, and an audit chain that doesn't capture
            // the prior value can't prove what changed.
            changes: fieldChanges,
          },
        },
        tx,
      );

      return after;
    });

    // Pino observability — log AFTER the tx commits. Field NAMES
    // only in the structured log; values stay in the AuthEvent table
    // (PII at rest, not at log).
    log("info", "account.me.updated", { userId, fields });

    // Identity reads happen AFTER the tx commits — they're read-only
    // and don't affect the atomicity guarantee. Keeping them outside
    // shrinks the row-lock window.
    const idents = await loadAccountIdentities(userId);
    const payload = buildAccountMePayload(afterRow, idents);
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof AuthError) {
      return jsonError("unauthorized", error.message, error.statusCode);
    }
    log("error", "account.me.patch.failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError("server_error", "Server error", 500);
  }
}
