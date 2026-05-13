import { z } from "zod";
import { registry } from "@/lib/openapi/registry";
import {
  Email,
  ErrorEnvelope,
  ValidationErrorEnvelope,
} from "@/lib/schemas/common";

// POST /api/v1/auth/login
//
// Step 21: `identifier` is now a discriminated-union object with
// `type` + `value`. Apple/Google sign-in will widen this schema
// when those routes land. Keeping the body narrow prevents
// advertising OAuth types we don't actually authenticate.
//
// 2026-05-13 phone-first widening: phone variant accepted. The
// backend matches an E.164 phone against a verified PHONE
// UserIdentifier and password-checks the linked user. Apple/Google
// remain out of scope until those IdP integrations ship.

const PhoneE164 = z
  .string()
  .regex(/^\+\d{7,15}$/, "Phone must be E.164 (e.g. +61400000000)");

export const LoginIdentifier = z.discriminatedUnion("type", [
  z.object({ type: z.literal("email"), value: Email }),
  z.object({ type: z.literal("phone"), value: PhoneE164 }),
]);

export const LoginBody = z.object({
  identifier: LoginIdentifier,
  password: z.string().min(1, "Password is required"),
});

export const LoginResponse = z.object({
  user: z.object({ id: z.string(), fullName: z.string().nullable() }),
  requires2FA: z.boolean(),
  twoFactorMethod: z.enum(["NONE", "TOTP", "SMS"]).optional(),
});

export const LoginVerificationRequiredResponse = z.object({
  requiresVerification: z.literal(true),
  email: z.string(),
  message: z.string(),
});

export type LoginBodyInput = z.infer<typeof LoginBody>;

registry.registerPath({
  method: "post",
  path: "/auth/login",
  tags: ["auth"],
  summary: "Authenticate with identifier + password",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: LoginBody } },
    },
  },
  responses: {
    200: {
      description: "Signed in (cookie set)",
      content: { "application/json": { schema: LoginResponse } },
    },
    202: {
      description: "Password OK but email unverified — code issued",
      content: {
        "application/json": { schema: LoginVerificationRequiredResponse },
      },
    },
    400: {
      description: "Malformed JSON",
      content: { "application/json": { schema: ErrorEnvelope } },
    },
    401: {
      description: "Bad credentials (reason: invalid_credentials)",
      content: { "application/json": { schema: ErrorEnvelope } },
    },
    422: {
      description: "Schema validation failed",
      content: { "application/json": { schema: ValidationErrorEnvelope } },
    },
    429: {
      description:
        "Rate-limited (reason: rate_limited). Retry-After header carries seconds.",
      content: { "application/json": { schema: ErrorEnvelope } },
    },
    500: {
      description:
        "Internal failure (reason: internal_error). Underlying error is logged but not exposed.",
      content: { "application/json": { schema: ErrorEnvelope } },
    },
  },
});
