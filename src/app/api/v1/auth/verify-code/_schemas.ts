import { z } from "zod";
import { registry } from "@/lib/openapi/registry";
import {
  Email,
  PhoneE164,
  SixDigitCode,
  ErrorEnvelope,
  ValidationErrorEnvelope,
} from "@/lib/schemas/common";

// POST /api/v1/auth/verify-code — step 2 of the verify-first wizard.
//
// 2026-05-13 phone-first widening: the body is now a discriminated
// union on `type`. The legacy `{ email, code }` shape stays accepted
// via the route's normalisation so older clients keep working.

const VerifyEmailBody = z.object({
  type: z.literal("email"),
  value: Email,
  code: SixDigitCode,
});

const VerifyPhoneBody = z.object({
  type: z.literal("phone"),
  value: PhoneE164,
  code: SixDigitCode,
});

export const VerifyCodeBody = z.discriminatedUnion("type", [
  VerifyEmailBody,
  VerifyPhoneBody,
]);

// Legacy `{ email, code }` shape — accepted indefinitely for the
// same reason send-code keeps a legacy fallback. The handler maps
// matching bodies to the discriminated form transparently.
export const LegacyVerifyCodeBody = z.object({
  email: Email,
  code: SixDigitCode,
});

export const VerifyCodeResponse = z.object({ verified: z.literal(true) });

export type VerifyCodeBodyInput = z.infer<typeof VerifyCodeBody>;
export type LegacyVerifyCodeBodyInput = z.infer<typeof LegacyVerifyCodeBody>;

registry.registerPath({
  method: "post",
  path: "/auth/verify-code",
  tags: ["auth"],
  summary: "Validate a 6-digit wizard code and open the 30-min claim window",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: VerifyCodeBody } },
    },
  },
  responses: {
    200: {
      description: "Code valid; claim window opened",
      content: { "application/json": { schema: VerifyCodeResponse } },
    },
    400: {
      description:
        "Malformed JSON or code reason (wrong_code / expired / used / no_token)",
      content: { "application/json": { schema: ErrorEnvelope } },
    },
    422: {
      description: "Schema validation failed",
      content: { "application/json": { schema: ValidationErrorEnvelope } },
    },
    429: {
      description: "Too many wrong attempts",
      content: { "application/json": { schema: ErrorEnvelope } },
    },
  },
});
