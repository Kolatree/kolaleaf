import { prisma } from "@/lib/db/client";
import { generateSmsCode, verifySmsCode } from "./phone";
import { sendSms } from "@/lib/sms";
import {
  PHONE_CODE_TTL_MINUTES,
  PHONE_CODE_MAX_ATTEMPTS,
  PHONE_CLAIM_WINDOW_MINUTES,
  PHONE_CODE_SENDS_PER_HOUR,
} from "./constants";
import type { VerifyCodeReason } from "./reasons";

// Phone-side mirror of pending-email-verification.ts. Same wizard
// state machine (send → verify → complete-registration), same
// PendingVerification table, different rail.
//
// The two helpers stay parallel rather than collapsing to one
// polymorphic function because the dispatch primitives diverge:
//   • Email goes through enqueueEmail → BullMQ worker → Resend
//     (queueable, async, retried by the worker).
//   • Phone goes through sendSms → Twilio (synchronous HTTPS call
//     with no app-side queue; Twilio retries server-side).
// The dispatch + hash primitives are different enough that a shared
// core would be 50% if/else and lose the readability win.
//
// Hashing also diverges: email uses generateVerificationCode
// (sha256 on a high-entropy token), phone uses generateSmsCode
// (bcrypt cost-4 on a 6-digit numeric code). The bcrypt choice is
// the same one the /api/v1/account/phone/add flow already commits
// to — see src/lib/auth/phone.ts for the rationale.

export interface IssuePendingPhoneOptions {
  /** E.164-normalised phone number. Callers MUST normalize upstream. */
  phone: string;
}

export type IssuePendingPhoneResult =
  | { ok: true; delivered: boolean }
  | { ok: false; reason: "rate_limited"; retryAfterMs: number }
  | { ok: false; reason: "claim_in_flight" }
  | { ok: false; reason: "send_failed"; providerError: string };

// Issue a 6-digit code for the PendingVerification row keyed by
// (kind='PHONE', identifier=phone). Rate-limited to
// PHONE_CODE_SENDS_PER_HOUR per phone; resend does NOT invalidate a
// live verified claim (claim preservation — same behaviour as the
// email path, see pending-email-verification.ts for the rationale).
export async function issuePendingPhoneCode(
  opts: IssuePendingPhoneOptions,
): Promise<IssuePendingPhoneResult> {
  const { phone } = opts;

  // 4-lens review fix (code-reviewer): defense-in-depth E.164 guard
  // at the helper boundary so a future caller bypassing the route
  // (admin tooling, worker job, script) cannot pass an unvalidated
  // string to Twilio. Regex matches the route's Zod schema verbatim
  // (src/app/api/v1/auth/send-code/_schemas.ts PhoneE164).
  if (!/^\+\d{7,15}$/.test(phone)) {
    return {
      ok: false,
      reason: "send_failed",
      providerError: "Phone must be E.164 (e.g. +61400000000)",
    };
  }

  const now = new Date();
  const windowMs = 60 * 60 * 1000;
  const windowOpenedAt = new Date(now.getTime() - windowMs);

  const existing = await prisma.pendingVerification.findUnique({
    where: { kind_identifier: { kind: "PHONE", identifier: phone } },
  });

  let nextSendCount: number;
  let nextWindowStart: Date;

  if (existing && existing.sendWindowStart > windowOpenedAt) {
    if (existing.sendCount >= PHONE_CODE_SENDS_PER_HOUR) {
      const retryAfterMs =
        existing.sendWindowStart.getTime() + windowMs - now.getTime();
      return {
        ok: false,
        reason: "rate_limited",
        retryAfterMs: Math.max(retryAfterMs, 0),
      };
    }
    nextSendCount = existing.sendCount + 1;
    nextWindowStart = existing.sendWindowStart;
  } else {
    nextSendCount = 1;
    nextWindowStart = now;
  }

  // Claim preservation: if a user has completed step 2 and is at
  // step 3 with a live claim, a resend MUST NOT wipe that claim —
  // otherwise anyone who knows the phone number can DoS the wizard.
  if (
    existing &&
    existing.verifiedAt !== null &&
    existing.claimExpiresAt !== null &&
    existing.claimExpiresAt > now
  ) {
    return { ok: false, reason: "claim_in_flight" };
  }

  const { code, hash } = generateSmsCode();
  const expiresAt = new Date(
    now.getTime() + PHONE_CODE_TTL_MINUTES * 60 * 1000,
  );

  await prisma.pendingVerification.upsert({
    where: { kind_identifier: { kind: "PHONE", identifier: phone } },
    create: {
      kind: "PHONE",
      identifier: phone,
      codeHash: hash,
      expiresAt,
      attempts: 0,
      verifiedAt: null,
      claimExpiresAt: null,
      sendCount: nextSendCount,
      sendWindowStart: nextWindowStart,
    },
    update: {
      codeHash: hash,
      expiresAt,
      attempts: 0,
      verifiedAt: null,
      claimExpiresAt: null,
      sendCount: nextSendCount,
      sendWindowStart: nextWindowStart,
    },
  });

  // SMS dispatch is synchronous (no app-side queue). A failure here
  // is reported back to the caller as send_failed; the row is
  // persisted so a retry-on-the-next-/send-code lands cleanly.
  const smsResult = await sendSms({
    to: phone,
    body: `Your Kolaleaf verification code is ${code}. It expires in ${PHONE_CODE_TTL_MINUTES} minutes. If you didn't request this, ignore this message.`,
  });
  if (!smsResult.ok) {
    return {
      ok: false,
      reason: "send_failed",
      providerError: smsResult.error ?? "SMS send failed",
    };
  }

  return { ok: true, delivered: true };
}

export type VerifyPendingPhoneOutcome =
  | { ok: true }
  | { ok: false; reason: VerifyCodeReason };

// Verify a 6-digit code for a PendingVerification row scoped to
// (kind='PHONE', identifier=phone). See pending-email-verification.ts
// for the shared state-machine reasoning (verified-but-claim-window,
// attempt-cap burn, etc.). The only structural difference is the
// bcrypt compare via verifySmsCode (the post-account add-phone flow
// also uses bcrypt; we stay aligned).
export async function verifyPendingPhoneCode(opts: {
  phone: string;
  code: string;
}): Promise<VerifyPendingPhoneOutcome> {
  const { phone, code } = opts;

  // 4-lens review fix (code-reviewer): same defense-in-depth guard
  // as the issue path. An unvalidated identifier on the verify side
  // would hit Prisma with a string that can't possibly match (the
  // backend never wrote a non-E.164 row), so this is functionally a
  // no-op fast-path — but it documents the contract at the helper
  // boundary and short-circuits the DB round-trip.
  if (!/^\+\d{7,15}$/.test(phone)) {
    return { ok: false, reason: "no_token" };
  }

  const row = await prisma.pendingVerification.findUnique({
    where: { kind_identifier: { kind: "PHONE", identifier: phone } },
  });
  if (!row) return { ok: false, reason: "no_token" };

  const now = new Date();

  if (row.verifiedAt !== null) {
    if (row.claimExpiresAt && row.claimExpiresAt > now) return { ok: true };
    return { ok: false, reason: "used" };
  }
  if (row.expiresAt < now) return { ok: false, reason: "expired" };
  if (row.attempts >= PHONE_CODE_MAX_ATTEMPTS) {
    return { ok: false, reason: "too_many_attempts" };
  }

  const match = await verifySmsCode(code, row.codeHash);
  const willHitCap = !match && row.attempts + 1 >= PHONE_CODE_MAX_ATTEMPTS;

  if (!match) {
    await prisma.pendingVerification.update({
      where: { id: row.id },
      data: {
        attempts: { increment: 1 },
        ...(willHitCap ? { expiresAt: new Date(now.getTime() - 1) } : {}),
      },
    });
    return {
      ok: false,
      reason: willHitCap ? "too_many_attempts" : "wrong_code",
    };
  }

  await prisma.pendingVerification.update({
    where: { id: row.id },
    data: {
      verifiedAt: now,
      claimExpiresAt: new Date(
        now.getTime() + PHONE_CLAIM_WINDOW_MINUTES * 60 * 1000,
      ),
    },
  });

  return { ok: true };
}
