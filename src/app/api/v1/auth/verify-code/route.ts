import { NextResponse } from "next/server";
import { verifyPendingEmailCode } from "@/lib/auth/pending-email-verification";
import { verifyPendingPhoneCode } from "@/lib/auth/pending-phone-verification";
import { jsonError } from "@/lib/http/json-error";
import { parseBody } from "@/lib/http/validate";
import { VerifyCodeBody, LegacyVerifyCodeBody } from "./_schemas";

// POST /api/v1/auth/verify-code
//
// Step 2 of the verify-first wizard. Validates the 6-digit code
// emailed/SMS'd in step 1 and, on success, opens a 10-30 minute
// claim window during which /complete-registration may consume it.
// Never issues a session.
//
// 2026-05-13 phone-first widening: body is a discriminated union
// on `type`. Legacy `{ email, code }` shape continues to work; the
// handler normalises to the discriminated form before dispatch.
export async function POST(request: Request) {
  // Shape-sniff first so the validation error routes to whichever
  // parser matches the client's intent (legacy callers see
  // `fields.email`, new callers see `fields.value`).
  const raw = await request
    .clone()
    .json()
    .catch(() => null);
  const looksDiscriminated = raw && typeof raw === "object" && "type" in raw;

  let payload: { type: "email" | "phone"; value: string; code: string };
  if (looksDiscriminated) {
    const parsed = await parseBody(request, VerifyCodeBody);
    if (!parsed.ok) return parsed.response;
    payload = parsed.data;
  } else {
    const parsed = await parseBody(request, LegacyVerifyCodeBody);
    if (!parsed.ok) return parsed.response;
    payload = {
      type: "email",
      value: parsed.data.email,
      code: parsed.data.code,
    };
  }

  const result =
    payload.type === "email"
      ? await verifyPendingEmailCode({
          email: payload.value,
          code: payload.code,
        })
      : await verifyPendingPhoneCode({
          phone: payload.value,
          code: payload.code,
        });

  if (!result.ok) {
    const status = result.reason === "too_many_attempts" ? 429 : 400;
    const message = ((): string => {
      switch (result.reason) {
        case "wrong_code":
          return "Incorrect code";
        case "expired":
          return "Code expired. Please request a new one.";
        case "used":
          return "This code was already used. Please start over.";
        case "too_many_attempts":
          return "Too many wrong attempts. Please request a new code.";
        case "no_token":
          return "No verification in progress for this identifier. Please request a new code.";
      }
    })();
    // too_many_attempts is a burned-token state (not a time-based rate
    // limit), so Retry-After: 0 tells RFC-6585-conforming clients they
    // can hit /send-code immediately.
    const headers: Record<string, string> | undefined =
      status === 429 ? { "Retry-After": "0" } : undefined;
    return jsonError(result.reason, message, status, headers);
  }

  return NextResponse.json({ verified: true }, { status: 200 });
}
