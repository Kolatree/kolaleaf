import { NextResponse } from "next/server";
import { initiateKyc, KycRateLimitError } from "@/lib/kyc/sumsub/kyc-service";
import { createSumsubClient } from "@/lib/kyc/sumsub";
import { requireAuth, AuthError } from "@/lib/auth/middleware";
import { jsonError } from "@/lib/http/json-error";

// Map AuthError messages to canonical reason codes so iOS reason-based dispatch
// can route 'email_unverified' to the verification flow without string-matching
// human copy. Falls back to 'unauthenticated' for anything else.
function authErrorReason(message: string, statusCode: number): string {
  if (statusCode === 403 && message === "email_unverified")
    return "email_unverified";
  if (statusCode === 401 && message === "2FA challenge required")
    return "two_factor_required";
  return "unauthenticated";
}

export async function POST(request: Request) {
  try {
    const { userId } = await requireAuth(request);
    const client = createSumsubClient();
    const result = await initiateKyc(userId, client);

    return NextResponse.json({
      applicantId: result.applicantId,
      accessToken: result.accessToken,
      verificationUrl: result.verificationUrl,
    });
  } catch (error) {
    // Phase 1 review fix: every error path now emits the canonical ErrorEnvelope
    // ({ error, reason }) so iOS BackendError decode succeeds and reason-based
    // dispatch fires — previously these returned `{ error }` only, which
    // surfaced as bare APIError.transport on iOS (the reason channel was dark).
    if (error instanceof AuthError) {
      return jsonError(
        authErrorReason(error.message, error.statusCode),
        error.message,
        error.statusCode,
      );
    }
    if (error instanceof KycRateLimitError) {
      // Phase 1 review fix: drop the body field `retryAfterMs` (undocumented +
      // unit-inconsistent with /auth/login's `retryAfter`). Retry-After header
      // (seconds) is the canonical channel.
      return jsonError(
        "rate_limited",
        "Too many KYC verification attempts. Please try again shortly.",
        429,
        { "Retry-After": String(Math.ceil(error.retryAfterMs / 1000)) },
      );
    }
    const message =
      error instanceof Error ? error.message : "KYC initiation failed";
    if (message === "KYC already verified") {
      return jsonError("kyc_already_verified", message, 409);
    }
    if (message === "KYC already in review") {
      return jsonError("kyc_already_in_review", message, 409);
    }
    return jsonError("kyc_initiate_failed", message, 500);
  }
}
