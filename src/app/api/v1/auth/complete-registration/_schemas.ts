import { z } from "zod";
import { registry } from "@/lib/openapi/registry";
import {
  Email,
  PhoneE164,
  Password,
  AU_STATE,
  Postcode,
  ErrorEnvelope,
  ValidationErrorEnvelope,
} from "@/lib/schemas/common";

// POST /api/v1/auth/complete-registration
//
// Step 3 of the verify-first wizard. The schema covers shape-level
// validation only; business-logic validation (NFKC name normalisation,
// password complexity, letter-required name guard, idempotent-retry
// password match) stays in the route because it needs more than a
// Zod rule can express cleanly.
//
// 2026-05-13 phone-first widening: identifier is now a discriminated
// union mirroring /auth/login's shape — email | phone. The phone
// branch consumes a verified PHONE-kind PendingVerification claim
// from the SMS wizard. Apple/Google remain out of scope until those
// IdP integrations ship.
const MAX_LEN = {
  fullName: 200,
  addressLine1: 200,
  addressLine2: 200,
  city: 100,
} as const;

export const CompleteRegistrationIdentifier = z.discriminatedUnion("type", [
  z.object({ type: z.literal("email"), value: Email }),
  z.object({ type: z.literal("phone"), value: PhoneE164 }),
]);

export const CompleteRegistrationBody = z.object({
  identifier: CompleteRegistrationIdentifier,
  fullName: z
    .string()
    .trim()
    .min(2, "Full name is required")
    .max(MAX_LEN.fullName),
  password: Password,
  addressLine1: z
    .string()
    .trim()
    .min(3, "Address line 1 is required")
    .max(MAX_LEN.addressLine1),
  addressLine2: z.string().trim().max(MAX_LEN.addressLine2).optional(),
  city: z.string().trim().min(1, "City is required").max(MAX_LEN.city),
  // Case-insensitive AU state — clients may submit 'nsw' or 'NSW'.
  state: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .pipe(AU_STATE),
  postcode: Postcode,
});

export const CompleteRegistrationResponse = z.object({
  user: z.object({
    id: z.string(),
    fullName: z.string(),
  }),
});

export type CompleteRegistrationBodyInput = z.infer<
  typeof CompleteRegistrationBody
>;
export type CompleteRegistrationResponseOutput = z.infer<
  typeof CompleteRegistrationResponse
>;

registry.registerPath({
  method: "post",
  path: "/auth/complete-registration",
  tags: ["auth"],
  summary:
    "Consume a verified email-or-phone claim and create the User account",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: CompleteRegistrationBody } },
    },
  },
  responses: {
    201: {
      description: "Account created; session cookie set",
      content: { "application/json": { schema: CompleteRegistrationResponse } },
    },
    400: {
      description:
        "Malformed JSON or business-logic failure (pending_not_verified / claim_expired / etc.)",
      content: { "application/json": { schema: ErrorEnvelope } },
    },
    409: {
      description: "Identifier (email or phone) already registered",
      content: { "application/json": { schema: ErrorEnvelope } },
    },
    422: {
      description: "Schema validation failed",
      content: { "application/json": { schema: ValidationErrorEnvelope } },
    },
  },
});
