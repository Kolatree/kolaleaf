import { z } from "zod";
import { registry } from "@/lib/openapi/registry";
import { ErrorEnvelope } from "@/lib/schemas/common";

// POST /api/v1/kyc/initiate — no request body. The Sumsub applicantId
// is derived from the authenticated session.

export const KycInitiateResponse = z.object({
  applicantId: z.string(),
  accessToken: z.string(),
  verificationUrl: z.string(),
});

registry.registerPath({
  method: "post",
  path: "/kyc/initiate",
  tags: ["kyc"],
  summary: "Kick off Sumsub KYC and return a WebSDK access token",
  responses: {
    200: {
      description: "Sumsub applicant created",
      content: { "application/json": { schema: KycInitiateResponse } },
    },
    401: {
      description:
        "Unauthenticated (reason: unauthenticated | two_factor_required)",
      content: { "application/json": { schema: ErrorEnvelope } },
    },
    403: {
      description: "Email not verified (reason: email_unverified)",
      content: { "application/json": { schema: ErrorEnvelope } },
    },
    409: {
      description:
        "KYC already verified / in review (reason: kyc_already_verified | kyc_already_in_review)",
      content: { "application/json": { schema: ErrorEnvelope } },
    },
    429: {
      description:
        "Rate-limited (reason: rate_limited). Retry-After header carries seconds.",
      content: { "application/json": { schema: ErrorEnvelope } },
    },
    500: {
      description:
        "KYC initiation failed (reason: kyc_initiate_failed). Underlying error is logged.",
      content: { "application/json": { schema: ErrorEnvelope } },
    },
  },
});
