// Single source of truth for the GET/PATCH `/api/v1/account/me`
// response shape. Both verbs build via this so the wire contract stays
// in one place — adding a field here propagates to both surfaces and
// the OpenAPI spec via `AccountMeResponse` parsing it back at the
// integration test layer.
//
// CA-005 / OO-002 fix: previously inlined inside
// `src/app/api/v1/account/me/route.ts`. Lifted so:
//   1. The HTTP route file is purely about HTTP concerns
//      (auth gating, rate-limit, transaction orchestration, error
//      envelopes).
//   2. The data-loading + payload-building logic is testable in
//      isolation and reusable from any future server-side surface
//      (admin tooling, scheduled summaries, etc.) that needs the same
//      account snapshot.
//
// `loadAccountMe` accepts an optional Prisma client so callers inside a
// `$transaction` callback can pass `tx` and keep the read consistent
// with the rest of the transaction. Falls back to the module-level
// `prisma` for the common GET path.
//
// Phase 3 (U29 + U30): exposes `displayName`, the AU address columns,
// and `kycStatus` alongside the existing identity / 2FA fields.

import type { z } from "zod";
import { prisma } from "@/lib/db/client";
import { maskPhone } from "@/lib/format/maskPhone";
import { AccountMeResponse } from "@/app/api/v1/account/me/_schemas";

// Explicit selection enumerated once. Keeps every read off `SELECT *`
// (which would 500 on any deploy where the new code lands before the
// migration). Exported so the route can pass the same shape into its
// transactional `tx.user.findUniqueOrThrow` / `tx.user.update` calls
// without redeclaring the column list.
export const ACCOUNT_ME_SELECT = {
  id: true,
  fullName: true,
  displayName: true,
  twoFactorMethod: true,
  twoFactorEnabledAt: true,
  twoFactorBackupCodes: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  postcode: true,
  country: true,
  kycStatus: true,
} as const;

export type SelectedAccountUser = {
  id: string;
  fullName: string | null;
  displayName: string | null;
  twoFactorMethod: string | null;
  twoFactorEnabledAt: Date | null;
  twoFactorBackupCodes: string[];
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: z.infer<typeof AccountMeResponse>["state"];
  postcode: string | null;
  country: string | null;
  kycStatus: z.infer<typeof AccountMeResponse>["kycStatus"];
};

// Minimal structural shape of the Prisma surface we need. Same pattern
// as `AuthEventWriter` in `lib/auth/audit.ts` — keeps this module from
// depending on the full `Prisma.TransactionClient` and lets callers
// pass either the top-level `prisma` instance or a `tx` handle.
export type AccountReader = {
  user: { findUniqueOrThrow: typeof prisma.user.findUniqueOrThrow };
  userIdentifier: {
    findFirst: typeof prisma.userIdentifier.findFirst;
    findMany: typeof prisma.userIdentifier.findMany;
  };
};

interface IdentityBundle {
  phone: { identifier: string } | null;
  emails: { id: string; identifier: string; verified: boolean }[];
}

async function loadIdentities(
  userId: string,
  client: AccountReader,
): Promise<IdentityBundle> {
  const [phone, emails] = await Promise.all([
    client.userIdentifier.findFirst({
      where: { userId, type: "PHONE", verified: true },
      orderBy: { createdAt: "asc" },
      select: { identifier: true },
    }),
    // All EMAIL identifiers for this user, oldest first. Primary = first
    // verified; if none is verified (edge case: pre-verification account)
    // fall back to first unverified. The rest are rendered as secondary
    // with Remove controls.
    client.userIdentifier.findMany({
      where: { userId, type: "EMAIL" },
      orderBy: { createdAt: "asc" },
      select: { id: true, identifier: true, verified: true },
    }),
  ]);
  return { phone, emails };
}

/**
 * Resolve the primary email identifier from a verified-first ordering.
 * `null` only when the user has zero EMAIL identifiers — extremely rare
 * (pre-verification edge cases or a deliberately phone-only account in
 * a future corridor).
 */
function pickPrimaryEmail(
  emails: IdentityBundle["emails"],
): IdentityBundle["emails"][number] | null {
  return emails.find((e) => e.verified) ?? emails[0] ?? null;
}

/** Build the wire payload from a fetched user row + identity bundle. */
export function buildAccountMePayload(
  user: SelectedAccountUser,
  idents: IdentityBundle,
): z.infer<typeof AccountMeResponse> {
  const primary = pickPrimaryEmail(idents.emails);
  const secondary = idents.emails.filter((e) => e.id !== primary?.id);

  return {
    userId: user.id,
    fullName: user.fullName,
    displayName: user.displayName,
    primaryEmail: primary
      ? {
          id: primary.id,
          email: primary.identifier,
          verified: primary.verified,
        }
      : null,
    secondaryEmails: secondary.map((e) => ({
      id: e.id,
      email: e.identifier,
      verified: e.verified,
    })),
    twoFactorMethod: user.twoFactorMethod,
    twoFactorEnabledAt: user.twoFactorEnabledAt?.toISOString() ?? null,
    hasVerifiedPhone: Boolean(idents.phone),
    phoneMasked: idents.phone ? maskPhone(idents.phone.identifier) : null,
    hasRemainingBackupCodes: user.twoFactorBackupCodes.length > 0,
    backupCodesRemaining: user.twoFactorBackupCodes.length,
    addressLine1: user.addressLine1,
    addressLine2: user.addressLine2,
    city: user.city,
    state: user.state,
    postcode: user.postcode,
    country: user.country,
    kycStatus: user.kycStatus,
  };
}

/**
 * Load the canonical /account/me payload for a user.
 *
 * Pass an optional Prisma client (the `tx` handle from a
 * `$transaction(async (tx) => …)` callback) to read the snapshot
 * consistently inside that transaction. Defaults to the module-level
 * `prisma` for non-transactional GET callers.
 */
export async function loadAccountMe(
  userId: string,
  client: AccountReader = prisma,
): Promise<z.infer<typeof AccountMeResponse>> {
  const [user, idents] = await Promise.all([
    client.user.findUniqueOrThrow({
      where: { id: userId },
      select: ACCOUNT_ME_SELECT,
    }),
    loadIdentities(userId, client),
  ]);
  return buildAccountMePayload(user as SelectedAccountUser, idents);
}

/** Identity loader exported for callers (like the PATCH route) that
 *  need the bundle without re-fetching the user row. */
export async function loadAccountIdentities(
  userId: string,
  client: AccountReader = prisma,
): Promise<IdentityBundle> {
  return loadIdentities(userId, client);
}
