import { z } from "zod";
import { registry } from "@/lib/openapi/registry";
import { ErrorEnvelope } from "@/lib/schemas/common";

// Phase 2 review fix (api-contract-002 / api-contract-003):
//   • `status` is pinned to the four authoritative `KycStatus` rawValues
//     from prisma/schema.prisma. iOS' KycStatus enum mirrors these
//     exactly; OpenAPI consumers get a real enum instead of an open
//     string.
//   • `applicantId` is declared. The route already returns it from
//     getKycStatus(), but the schema previously omitted it so the
//     OpenAPI doc lied to clients.
// `.passthrough()` is preserved so a future backend additive (e.g.
// `rejectionReasons: string[]`) doesn't break existing clients before
// they're updated.

export const KycStatusValue = z.enum([
  "PENDING",
  "IN_REVIEW",
  "VERIFIED",
  "REJECTED",
]);

export const KycStatusResponse = z
  .object({
    status: KycStatusValue,
    applicantId: z.string().optional(),
  })
  .passthrough();

registry.registerPath({
  method: "get",
  path: "/kyc/status",
  tags: ["kyc"],
  summary: "Get the current user's KYC status",
  responses: {
    200: {
      description: "KYC status",
      content: { "application/json": { schema: KycStatusResponse } },
    },
    401: {
      description: "Unauthenticated (reason: unauthenticated)",
      content: { "application/json": { schema: ErrorEnvelope } },
    },
    500: {
      description: "KYC status fetch failed (reason: kyc_status_failed)",
      content: { "application/json": { schema: ErrorEnvelope } },
    },
  },
});
