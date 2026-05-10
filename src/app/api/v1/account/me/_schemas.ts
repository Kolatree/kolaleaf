import { z } from "zod";
import { registry } from "@/lib/openapi/registry";
import {
  AU_STATE,
  ErrorEnvelope,
  IdentityString,
  NullableIdentityString,
  Postcode,
  ValidationErrorEnvelope,
} from "@/lib/schemas/common";
import {
  AuState as PrismaAuState,
  KycStatus as PrismaKycStatus,
} from "@/generated/prisma/client";

// /api/v1/account/me — schemas for both GET (response shape) and PATCH
// (Phase 3 / U29 + U30 partial-update path).
//
// Backend rules:
//   - Empty strings on PATCH normalise to NULL on the column. The
//     `nullableTrimmed` helper centralises that contract per-field so
//     one-character drift can't silently leave whitespace in a column.
//   - DOB is NOT mutable here — Sumsub KYC verified it; surfacing it
//     for re-edit would invalidate the AML/CTF audit chain.
//   - Legal name (`fullName`) is NOT mutable here — name changes on a
//     KYC'd account require a separate review path that doesn't exist
//     in Wave 1.

const EmailIdentifier = z.object({
  id: z.string(),
  email: z.string(),
  verified: z.boolean(),
});

// `displayName` is the only mutable identity field on this surface.
// Address columns mirror the User model exactly (nullable strings on
// the row; `state` constrained to AuState by Postgres enum).
//
// `kycStatus` round-trips the Prisma enum so the iOS client never has
// to know the wire-string values directly — `z.nativeEnum` validates
// + types the response.
//
// API-007: the primary email field is named `primaryEmail` (not just
// `email`) so the contract telegraphs the relationship to
// `secondaryEmails` — both lists carry the same `EmailIdentifier`
// shape and a single `email` next to a plural `secondaryEmails` reads
// asymmetrically.
export const AccountMeResponse = z.object({
  userId: z.string(),
  fullName: z.string().nullable(),
  displayName: z.string().nullable(),
  primaryEmail: EmailIdentifier.nullable(),
  secondaryEmails: z.array(EmailIdentifier),
  twoFactorMethod: z.string().nullable(),
  twoFactorEnabledAt: z.string().nullable(),
  hasVerifiedPhone: z.boolean(),
  phoneMasked: z.string().nullable(),
  hasRemainingBackupCodes: z.boolean(),
  backupCodesRemaining: z.number().int(),
  addressLine1: z.string().nullable(),
  addressLine2: z.string().nullable(),
  city: z.string().nullable(),
  state: z.nativeEnum(PrismaAuState).nullable(),
  postcode: z.string().nullable(),
  country: z.string().nullable(),
  kycStatus: z.nativeEnum(PrismaKycStatus),
});

export type AccountMeResponseOutput = z.infer<typeof AccountMeResponse>;

// PATCH /api/v1/account/me — partial-update body. Every field is
// optional. PII strings flow through `IdentityString` /
// `NullableIdentityString` (centralised in `@/lib/schemas/common`) so
// every surface that takes user-typed identity rejects bidi-control,
// zero-width, and Unicode-compatibility attacks the same way. Address
// fields normalise blank → null so the column-NULL contract stays
// uniform.
export const PatchMeBody = z
  .object({
    // 1..40 to keep avatars + nav rendering tight. `requireLetter`
    // forces at least one Unicode letter so a zero-width-only or
    // numeric-only display name can't render blank on receipts.
    displayName: IdentityString(40, { requireLetter: true }),
    // Address fields: nullable (clearable to NULL) and not letter-
    // gated since "12 Pitt St" / "5/2 …" / "Apt 4B" can legitimately
    // start with digits.
    addressLine1: NullableIdentityString(100),
    addressLine2: NullableIdentityString(100),
    city: NullableIdentityString(50, { requireLetter: true }),
    // Case-insensitive AU state — same transform as
    // /auth/complete-registration so iOS and web behave identically.
    state: z
      .string()
      .trim()
      .transform((v) => v.toUpperCase())
      .pipe(AU_STATE),
    postcode: Postcode,
    // Wave 1 is AU-only. When adding a corridor, change this to a
    // union of allowed countries — and audit every transfer-routing
    // assumption (PayID, Sumsub residency, FX corridor selection)
    // before relaxing it. Accepting any 2-letter code here would let
    // a sanctioned-country user (RU, IR, KP) overwrite the AU
    // residence we KYC'd against.
    country: z.literal("AU"),
  })
  .strict()
  .partial();

export type PatchMeBodyInput = z.infer<typeof PatchMeBody>;

registry.registerPath({
  method: "get",
  path: "/account/me",
  tags: ["account"],
  summary: "Get the authenticated user account summary",
  responses: {
    200: {
      description: "Account summary",
      content: { "application/json": { schema: AccountMeResponse } },
    },
    401: {
      description: "Unauthenticated",
      content: { "application/json": { schema: ErrorEnvelope } },
    },
  },
});

registry.registerPath({
  method: "patch",
  path: "/account/me",
  tags: ["account"],
  summary: "Update mutable account fields (displayName + AU address)",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: PatchMeBody } },
    },
  },
  responses: {
    200: {
      description: "Updated account summary",
      content: { "application/json": { schema: AccountMeResponse } },
    },
    400: {
      description: "Malformed JSON",
      content: { "application/json": { schema: ErrorEnvelope } },
    },
    401: {
      description: "Unauthenticated",
      content: { "application/json": { schema: ErrorEnvelope } },
    },
    422: {
      description: "Schema validation failed",
      content: { "application/json": { schema: ValidationErrorEnvelope } },
    },
  },
});
