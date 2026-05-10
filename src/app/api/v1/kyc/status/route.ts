import { NextResponse } from "next/server";
import { getKycStatus } from "@/lib/kyc/sumsub/kyc-service";
import { requireAuth, AuthError } from "@/lib/auth/middleware";
import { jsonError } from "@/lib/http/json-error";

// Phase 2 review fix (api-contract-001): error responses now use the
// canonical `{ error, reason }` envelope instead of bare `{ error }`,
// matching the ErrorEnvelope schema declared in _schemas.ts. iOS
// (and other clients) can dispatch on `reason` rather than string-
// matching `error` copy.

export async function GET(request: Request) {
  try {
    const { userId } = await requireAuth(request);
    const status = await getKycStatus(userId);
    return NextResponse.json(status);
  } catch (error) {
    if (error instanceof AuthError) {
      const reason = error.statusCode === 401 ? "unauthenticated" : "forbidden";
      return jsonError(reason, error.message, error.statusCode);
    }
    return jsonError("kyc_status_failed", "Failed to get KYC status", 500);
  }
}
