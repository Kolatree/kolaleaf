import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { issuePendingEmailCode } from "@/lib/auth/pending-email-verification";
import { issuePendingPhoneCode } from "@/lib/auth/pending-phone-verification";
import { parseBody } from "@/lib/http/validate";
import { log } from "@/lib/obs/logger";
import { SendCodeBody, LegacySendCodeBody } from "./_schemas";

// POST /api/v1/auth/send-code
//
// Step 1 of the verify-first wizard: issue a 6-digit code to the
// target identifier (email OR phone). Enumeration-proof: ALWAYS 200
// regardless of whether the identifier is known/free/rate-limited.
// The only non-2xx paths are schema failure (422 via Zod) and
// malformed JSON (400).
//
// Resend / SMS-send run fire-and-forget after the route has returned
// — on Railway (Node, not serverless) the promise completes even
// after the response flushes. This removes the 300-800ms provider
// round-trip from the request path while preserving the "always 200"
// contract.
//
// 2026-05-13 phone-first widening:
//   • Body now supports the discriminated `{ type: 'email'|'phone', value }`
//     shape (SendCodeBody).
//   • Legacy `{ email }` requests still accepted (LegacySendCodeBody)
//     so older in-flight clients keep working — normalised to the
//     discriminated form before branching.
//   • Phone variant goes through issuePendingPhoneCode → sendSms;
//     email variant unchanged from before.
export async function POST(request: Request) {
  // Detect body shape by sniffing whether `type` is present. This
  // lets us return the parser's error response that matches the
  // client's apparent intent — older `{ email }` callers see
  // `fields.email`, newer `{ type, value }` callers see
  // `fields.value`/`fields.type`. Reading body once and re-feeding
  // a Response-like view to parseBody keeps the contract simple.
  const raw = await request
    .clone()
    .json()
    .catch(() => null);
  const looksDiscriminated = raw && typeof raw === "object" && "type" in raw;

  let identifier: { type: "email" | "phone"; value: string };
  if (looksDiscriminated) {
    const parsed = await parseBody(request, SendCodeBody);
    if (!parsed.ok) return parsed.response;
    identifier = parsed.data;
  } else {
    const parsed = await parseBody(request, LegacySendCodeBody);
    if (!parsed.ok) return parsed.response;
    identifier = { type: "email", value: parsed.data.email };
  }

  if (identifier.type === "email") {
    return handleEmailSend(identifier.value);
  }
  return handlePhoneSend(identifier.value);
}

async function handleEmailSend(email: string): Promise<Response> {
  // Short-circuit for already-verified-and-owned emails. Prevents a
  // duplicate-email fraud attempt from stealing a verification slot
  // AND stops us acting as an enumeration oracle by sending the real
  // user a spurious code.
  const existing = await prisma.userIdentifier.findUnique({
    where: { identifier: email },
  });
  if (existing && existing.type === "EMAIL" && existing.verified) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // Fire-and-forget. Response goes out immediately; the helper runs
  // to completion in the background. Structured logs surface
  // rate_limited / send_failed / unexpected without leaking state
  // to the client.
  issuePendingEmailCode({ email })
    .then(async (result) => {
      if (!result.ok) {
        log("warn", "auth.send-code.issue.failed", {
          kind: "EMAIL",
          reason: result.reason,
          identifierHash: await sha256Hex(email),
          ...("providerError" in result
            ? { providerError: result.providerError }
            : {}),
          ...("retryAfterMs" in result
            ? { retryAfterMs: result.retryAfterMs }
            : {}),
        });
      }
    })
    .catch(async (err) => {
      log("error", "auth.send-code.unexpected", {
        kind: "EMAIL",
        identifierHash: await sha256Hex(email),
        error: err instanceof Error ? err.message : String(err),
      });
    });

  return NextResponse.json({ ok: true }, { status: 200 });
}

async function handlePhoneSend(phone: string): Promise<Response> {
  // Mirror of handleEmailSend: silently 200 when the phone is
  // already a verified UserIdentifier so we don't act as an
  // enumeration oracle. Phone E.164 strings are the same shape
  // here as in `/account/phone/add` — the same UserIdentifier rows
  // back both flows.
  const existing = await prisma.userIdentifier.findUnique({
    where: { identifier: phone },
  });
  if (existing && existing.type === "PHONE" && existing.verified) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // Fire-and-forget SMS dispatch. Unlike the email path (queued
  // via BullMQ), this goes straight to sendSms → Twilio. Twilio
  // handles retries server-side; the helper's `send_failed`
  // outcome only fires when the HTTPS call itself fails or the
  // Twilio client refuses to load. Logged for ops visibility.
  issuePendingPhoneCode({ phone })
    .then(async (result) => {
      if (!result.ok) {
        log("warn", "auth.send-code.issue.failed", {
          kind: "PHONE",
          reason: result.reason,
          identifierHash: await sha256Hex(phone),
          ...("providerError" in result
            ? { providerError: result.providerError }
            : {}),
          ...("retryAfterMs" in result
            ? { retryAfterMs: result.retryAfterMs }
            : {}),
        });
      }
    })
    .catch(async (err) => {
      log("error", "auth.send-code.unexpected", {
        kind: "PHONE",
        identifierHash: await sha256Hex(phone),
        error: err instanceof Error ? err.message : String(err),
      });
    });

  return NextResponse.json({ ok: true }, { status: 200 });
}

// Hash the identifier for log correlation without persisting raw
// PII in log storage. Reversible via rainbow tables against a known
// target list, so this is log-hygiene, not a secrecy guarantee.
async function sha256Hex(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
