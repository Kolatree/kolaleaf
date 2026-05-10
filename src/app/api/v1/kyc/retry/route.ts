import { NextResponse } from "next/server";
import { retryKyc } from "@/lib/kyc/sumsub/kyc-service";
import { createSumsubClient } from "@/lib/kyc/sumsub";
import { requireAuth, AuthError } from "@/lib/auth/middleware";
import { jsonError } from "@/lib/http/json-error";

// POST /api/v1/kyc/retry
//
// Exists because retryKyc() in kyc-service.ts was implemented and
// tested but had no HTTP route — a REJECTED user had no way to try
// again (Wave 1 audit P0 gap #4). This wraps the existing function
// with the same 409-on-wrong-state + 401-on-unauth conventions as
// /kyc/initiate.
//
// Phase 2 review fix (api-contract-001 / api-contract-005): every
// error path now emits the canonical `{ error, reason }` envelope.
// Distinct 409 conditions get distinct reasons (`kyc_not_rejected` vs
// `kyc_no_application`) so iOS branches programmatically instead of
// matching English copy.
export async function POST(request: Request) {
  try {
    const { userId } = await requireAuth(request);
    const client = createSumsubClient();
    const result = await retryKyc(userId, client);
    return NextResponse.json({
      accessToken: result.accessToken,
      verificationUrl: result.verificationUrl,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      const reason = error.statusCode === 401 ? "unauthenticated" : "forbidden";
      return jsonError(reason, error.message, error.statusCode);
    }
    const message = error instanceof Error ? error.message : "KYC retry failed";
    if (message === "KYC retry only available for rejected applications") {
      return jsonError("kyc_not_rejected", message, 409);
    }
    if (message === "No existing KYC application to retry") {
      return jsonError("kyc_no_application", message, 409);
    }
    return jsonError("kyc_retry_failed", message, 500);
  }
}
