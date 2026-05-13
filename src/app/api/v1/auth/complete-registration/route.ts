import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import {
  hashPassword,
  validatePasswordComplexity,
  verifyPassword,
} from "@/lib/auth/password";
import { setSessionCookie } from "@/lib/auth/middleware";
import { buildSessionData } from "@/lib/auth/sessions";
import { logAuthEvent, logAuthEventsMany } from "@/lib/auth/audit";
import type { CompleteRegistrationReason } from "@/lib/auth/reasons";
import { jsonError } from "@/lib/http/json-error";
import { parseBody } from "@/lib/http/validate";
import { log } from "@/lib/obs/logger";
import { extractRequestContext } from "@/lib/security/request-context";
import { CompleteRegistrationBody } from "./_schemas";

// POST /api/v1/auth/complete-registration
//
// Step 3 — and the only step that writes to User. The caller must have
// previously completed /send-code and /verify-code; that leaves a
// PendingVerification row (kind=EMAIL or PHONE) with verifiedAt set
// and claimExpiresAt still in the future. This endpoint consumes that
// claim to create the User, the verified UserIdentifier, and the
// Session, and deletes the pending row — all in one transaction.
//
// Shape-level validation (email format, E.164 phone, field lengths,
// AU_STATE / postcode regex) lives in _schemas.ts. Business-logic
// validation (NFKC normalisation, password complexity, letter-required
// name guard, idempotent-retry password match) stays here because it
// can't be expressed cleanly in a Zod rule.
//
// 2026-05-13 phone-first widening: identifier is now a discriminated
// union (email | phone) mirroring /auth/login. The phone branch is a
// 1:1 mirror of the email branch — same state machine, same
// idempotent-retry short-circuit, same race guard — keyed by the
// PHONE-kind PendingVerification row issued by the SMS wizard.
const HAS_LETTER_RE = /\p{L}/u;
const TX_TIMEOUT_MS = 15_000;
const TX_MAX_WAIT_MS = 5_000;

type Reason = CompleteRegistrationReason;
type Rail = "email" | "phone";

interface RailCopy {
  /** Returned when no PendingVerification row exists for the rail. */
  verifyToContinue: string;
  /** Returned when the row exists but `verifiedAt` is still null. */
  verifyFirst: string;
  /** Returned when the claim window (`claimExpiresAt`) has passed. */
  claimExpired: string;
  /** Returned on the race-guard / idempotent-retry-mismatch 409s. */
  alreadyRegistered: string;
}

// Rail-keyed user-facing copy. Promoted from an inline object literal
// to a top-of-file table so new rails (Apple, Google) land as a new
// row rather than another branch inside copyFor(). Strings are kept
// byte-identical to pre-widening (D4a) so existing client surfaces,
// test assertions, and audit-log greps don't regress.
const RAIL_COPY: Record<Rail, RailCopy> = {
  email: {
    verifyToContinue: "Verify your email to continue",
    verifyFirst: "Please verify your email first",
    claimExpired: "Your verification expired. Please start again.",
    alreadyRegistered: "Email already registered",
  },
  phone: {
    verifyToContinue: "Verify your phone to continue",
    verifyFirst: "Please verify your phone first",
    claimExpired: "Your verification expired. Please start again.",
    alreadyRegistered: "Phone number already registered",
  },
};

// Wire-format ('email' | 'phone') → Prisma IdentifierType enum
// ('EMAIL' | 'PHONE'). Kept tiny and local so the branch sites read
// cleanly without re-deriving the mapping each time.
function kindOf(type: Rail): "EMAIL" | "PHONE" {
  return type === "phone" ? "PHONE" : "EMAIL";
}

export async function POST(request: Request) {
  const parsed = await parseBody(request, CompleteRegistrationBody);
  if (!parsed.ok) return parsed.response;
  const {
    identifier,
    fullName: rawFullName,
    password,
    addressLine1,
    addressLine2: rawLine2,
    city,
    state,
    postcode,
  } = parsed.data;

  const identifierValue = identifier.value;
  const dbKind = kindOf(identifier.type);
  const copy = RAIL_COPY[identifier.type];

  // Password complexity (character-class mix) isn't length-only and
  // isn't captured by the Zod schema — keep the existing helper.
  const pwCheck = validatePasswordComplexity(password);
  if (!pwCheck.ok) {
    return jsonError("weak_password" satisfies Reason, pwCheck.error, 400);
  }

  // Unicode NFKC + letter-required guard. Rejects zero-width-only
  // names that satisfy .trim().length but render empty — those would
  // corrupt the AUSTRAC audit trail's legal-name column.
  const fullNameNormalized = rawFullName
    .normalize("NFKC")
    .replace(/[​-‏‪-‮⁠-⁯﻿]/g, "")
    .trim();
  if (
    fullNameNormalized.length < 2 ||
    !HAS_LETTER_RE.test(fullNameNormalized)
  ) {
    return jsonError(
      "name_letters_required" satisfies Reason,
      "Full name must contain at least one letter",
      400,
    );
  }

  const fullName = fullNameNormalized;
  const addressLine2 = rawLine2 && rawLine2.length > 0 ? rawLine2 : null;
  const securityContext = extractRequestContext(request);
  const { ip, userAgent, country, deviceFingerprintHash } = securityContext;

  // Idempotent-retry short-circuit. If the client re-posts after a
  // successful-but-dropped response, the tx already deleted the pending
  // row — the old path would return 400 telling the user to verify
  // again, which strands them. Instead: if a verified UserIdentifier
  // of the SAME rail already exists for this identifier AND the
  // submitted password matches the stored hash, treat this as a retry
  // of the just-succeeded call. Mismatched password → 409. Hash is
  // computed LATER so we don't burn bcrypt time on the retry path.
  const maybeExisting = await prisma.userIdentifier.findUnique({
    where: { identifier: identifierValue },
    include: { user: true },
  });
  if (
    maybeExisting &&
    maybeExisting.type === dbKind &&
    maybeExisting.verified
  ) {
    const u = maybeExisting.user;
    if (
      !u.passwordHash ||
      !(await verifyPassword(pwCheck.password, u.passwordHash))
    ) {
      return jsonError(
        "already_registered" satisfies Reason,
        copy.alreadyRegistered,
        409,
      );
    }
    const session = await prisma.session.create({
      data: buildSessionData(u.id, ip, userAgent),
    });
    await logAuthEvent({
      userId: u.id,
      event: "LOGIN",
      ip,
      metadata: {
        via: "complete-registration-retry",
        ...(country ? { country } : {}),
        ...(deviceFingerprintHash ? { deviceFingerprintHash } : {}),
      },
    });
    const response = NextResponse.json(
      { user: { id: u.id, fullName: u.fullName } },
      { status: 201 },
    );
    // .append (not .set): sibling routes (auth/login) emit multiple
    // Set-Cookie headers so any cookie ops the caller layers on top
    // don't get silently overwritten.
    response.headers.append("Set-Cookie", setSessionCookie(session.token));
    return response;
  }

  // Only hash once we know we're creating a new user (bcrypt is ~300ms
  // at cost 12 — no reason to burn it on the retry/409 paths above).
  const passwordHash = await hashPassword(pwCheck.password);

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const pending = await tx.pendingVerification.findUnique({
          where: {
            kind_identifier: { kind: dbKind, identifier: identifierValue },
          },
        });
        if (!pending) {
          throw new CompleteError(
            "no_pending_verification",
            400,
            copy.verifyToContinue,
          );
        }
        if (!pending.verifiedAt) {
          throw new CompleteError(
            "pending_not_verified",
            400,
            copy.verifyFirst,
          );
        }
        // Boundary: claim is valid iff now < claimExpiresAt.
        if (!pending.claimExpiresAt || pending.claimExpiresAt <= new Date()) {
          throw new CompleteError("claim_expired", 400, copy.claimExpired);
        }

        // Race guard + OAuth protection + active-session protection.
        const existing = await tx.userIdentifier.findUnique({
          where: { identifier: identifierValue },
          include: {
            user: {
              select: {
                _count: { select: { sessions: true, transfers: true } },
              },
            },
          },
        });
        if (existing && (existing.type !== dbKind || existing.verified)) {
          throw new CompleteError(
            "already_registered",
            409,
            copy.alreadyRegistered,
          );
        }
        if (existing) {
          const legacyActivity =
            existing.user._count.sessions + existing.user._count.transfers;
          if (legacyActivity > 0) {
            throw new CompleteError(
              "already_registered",
              409,
              copy.alreadyRegistered,
            );
          }
        }

        const user = await tx.user.create({
          data: {
            fullName,
            passwordHash,
            addressLine1,
            addressLine2,
            city,
            state,
            postcode,
            country: "AU",
          },
        });

        // Clean up the stale UNVERIFIED identifier of the SAME rail
        // (if any) so the new row's unique constraint can land.
        // deleteMany is a no-op on missing rows, avoiding P2025 under
        // concurrent cleanup.
        if (existing && existing.type === dbKind && !existing.verified) {
          await tx.userIdentifier.deleteMany({ where: { id: existing.id } });
        }
        await tx.userIdentifier.create({
          data: {
            userId: user.id,
            type: dbKind,
            identifier: identifierValue,
            verified: true,
            verifiedAt: new Date(),
          },
        });

        const session = await tx.session.create({
          data: buildSessionData(user.id, ip, userAgent),
        });

        await tx.pendingVerification.delete({
          where: {
            kind_identifier: { kind: dbKind, identifier: identifierValue },
          },
        });

        // Batch REGISTER + LOGIN into a single createMany round-trip,
        // shrinking the tx's lock window.
        //
        // Security-context fields (country + deviceFingerprintHash)
        // are persisted onto the REGISTER/LOGIN events so the
        // anomaly detector (Step 32) has a baseline fingerprint for
        // every future login. First event → no anomaly check fires;
        // this row IS the baseline.
        const baseSecurity = {
          ...(country ? { country } : {}),
          ...(deviceFingerprintHash ? { deviceFingerprintHash } : {}),
        };
        const loginVia =
          identifier.type === "phone"
            ? "phone-verification"
            : "email-verification";
        await logAuthEventsMany(
          [
            {
              userId: user.id,
              event: "REGISTER",
              ip,
              metadata: { via: "verify-first", ...baseSecurity },
            },
            {
              userId: user.id,
              event: "LOGIN",
              ip,
              metadata: { via: loginVia, ...baseSecurity },
            },
          ],
          tx,
        );

        return { user, session };
      },
      { timeout: TX_TIMEOUT_MS, maxWait: TX_MAX_WAIT_MS },
    );

    const response = NextResponse.json(
      { user: { id: result.user.id, fullName: result.user.fullName } },
      { status: 201 },
    );
    // .append (not .set): mirrors auth/login so additional Set-Cookie
    // headers (e.g. cookie clears layered by middleware) coexist
    // instead of clobbering the session cookie.
    response.headers.append(
      "Set-Cookie",
      setSessionCookie(result.session.token),
    );
    return response;
  } catch (err) {
    if (err instanceof CompleteError) {
      return jsonError(err.reason, err.message, err.statusCode);
    }
    // P2002 — unique-constraint violation. Under concurrent requests
    // one tx wins and the other hits P2002 on UserIdentifier.identifier
    // — that's a 409, not a 500. The constraint is on the identifier
    // string column itself, so this catches both rails uniformly.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return jsonError(
        "already_registered" satisfies Reason,
        copy.alreadyRegistered,
        409,
      );
    }
    log("error", "auth.complete-registration.failed", {
      reason: "unexpected",
      error: err instanceof Error ? err.message : String(err),
    });
    return jsonError("unexpected" satisfies Reason, "Registration failed", 500);
  }
}

class CompleteError extends Error {
  public readonly statusCode: number;
  public readonly reason: Reason;

  constructor(reason: Reason, statusCode: number, message: string) {
    super(message);
    this.name = "CompleteError";
    this.reason = reason;
    this.statusCode = statusCode;
  }
}
