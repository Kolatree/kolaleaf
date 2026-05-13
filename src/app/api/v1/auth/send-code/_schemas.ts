import { z } from "zod";
import { registry } from "@/lib/openapi/registry";
import {
  Email,
  PhoneE164,
  ErrorEnvelope,
  ValidationErrorEnvelope,
} from "@/lib/schemas/common";

// POST /api/v1/auth/send-code
//
// Step 1 of the verify-first wizard: issue a 6-digit code to the
// target identifier. Enumeration-proof — always 200 regardless of
// whether the identifier is known / rate-limited / bounced. Schema
// failure (malformed identifier, missing field) is the only non-2xx
// signal and maps to 422 with `fields.<field>`.
//
// 2026-05-13 phone-first widening: the body is a discriminated union
// on `type`. The legacy `{ email }` shape stays accepted via the
// `.or(LegacyEmailOnlyBody)` fallback so any in-flight clients on
// older API contracts keep working — the route normalises both
// shapes to the discriminated form before branching.

const EmailIdentifier = z.object({
  type: z.literal("email"),
  value: Email,
});

const PhoneIdentifier = z.object({
  type: z.literal("phone"),
  value: PhoneE164,
});

export const SendCodeBody = z.discriminatedUnion("type", [
  EmailIdentifier,
  PhoneIdentifier,
]);

// Legacy `{ email }` shape — accepted indefinitely so an in-flight
// older iOS build doesn't break on deploy. The route handler maps
// matching bodies to the discriminated form transparently.
export const LegacySendCodeBody = z.object({
  email: Email,
});

export const SendCodeResponse = z.object({
  ok: z.literal(true),
});

export type SendCodeBodyInput = z.infer<typeof SendCodeBody>;
export type LegacySendCodeBodyInput = z.infer<typeof LegacySendCodeBody>;
export type SendCodeResponseOutput = z.infer<typeof SendCodeResponse>;

registry.registerPath({
  method: "post",
  path: "/auth/send-code",
  tags: ["auth"],
  summary: "Send a 6-digit email verification code",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: SendCodeBody } },
    },
  },
  responses: {
    200: {
      description:
        "Code issued (or silently skipped for enumeration-proof reasons)",
      content: { "application/json": { schema: SendCodeResponse } },
    },
    422: {
      description: "Schema validation failed",
      content: { "application/json": { schema: ValidationErrorEnvelope } },
    },
    400: {
      description: "Malformed JSON",
      content: { "application/json": { schema: ErrorEnvelope } },
    },
  },
});
