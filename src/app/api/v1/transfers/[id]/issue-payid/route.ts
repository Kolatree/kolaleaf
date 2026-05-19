import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { requireEmailVerified, AuthError } from "@/lib/auth/middleware";
import { generatePayIdForTransfer } from "@/lib/payments/monoova";
import { createMonoovaClient } from "@/lib/payments/monoova/client";
import {
  TransferNotFoundError,
  KycNotVerifiedError,
  ConcurrentModificationError,
} from "@/lib/transfers/errors";
import { jsonError } from "@/lib/http/json-error";
import { log } from "@/lib/obs/logger";
import "./_schemas";

// POST /api/v1/transfers/:id/issue-payid
//
// User-facing trigger for the CREATED → AWAITING_AUD transition. The
// AUSTRAC money-handler boundary still lives one layer down inside
// generatePayIdForTransfer (which enforces the KYC gate unless
// KOLA_DISABLE_KYC_GATE is set in dev); this route only adds authn +
// ownership + state-precondition checks.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let transferId: string | undefined;
  try {
    // Auth runs before the state-precondition + resource-existence
    // checks so an unauthenticated probe can't enumerate transfer
    // ids by 401-vs-404 timing. `requireEmailVerified` internally
    // calls `requireAuth` so a second call is redundant.
    const { userId } = await requireEmailVerified(request);

    const routeParams = await params;
    transferId = routeParams.id;

    // Ownership check: the transfer must belong to the authenticated
    // user. Returning 403 (not 404) for a non-owned existing transfer
    // is consistent with the admin-route pattern; non-owners still
    // can't discover whether the id is valid because every failure
    // above this point is 401 or 403.
    const existing = await prisma.transfer.findUnique({
      where: { id: routeParams.id },
      select: { userId: true },
    });
    if (!existing) {
      return jsonError("transfer_not_found", "Transfer not found", 404);
    }
    if (existing.userId !== userId) {
      return jsonError("forbidden", "Forbidden", 403);
    }

    const transfer = await generatePayIdForTransfer(
      routeParams.id,
      createMonoovaClient(),
    );

    // Iter-2 (S16 / ADV-P6-S5): surface the AWAITING_AUD deadline so
    // the iOS countdown doesn't depend on iOS-side wall-clock drift.
    // The 24h window matches the backend cleanup cron; we derive it
    // from the transfer's `updatedAt` (which the state transition
    // bumped during this request). Defensive null-check so a partial
    // shape from older mocks doesn't trip the route.
    const expiryMs = 24 * 60 * 60 * 1000;
    const baseTimestamp =
      transfer.updatedAt instanceof Date ? transfer.updatedAt : new Date();
    const transferWithExpiry = {
      ...transfer,
      payidExpiresAt: new Date(
        baseTimestamp.getTime() + expiryMs,
      ).toISOString(),
    };

    return NextResponse.json({ transfer: transferWithExpiry });
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.message === "email_unverified") {
        return jsonError(
          "email_unverified",
          "Please verify your email before issuing a PayID.",
          403,
        );
      }
      return jsonError(
        error.statusCode === 401 ? "unauthenticated" : "forbidden",
        error.message,
        error.statusCode,
      );
    }

    if (error instanceof TransferNotFoundError) {
      return jsonError("transfer_not_found", error.message, 404);
    }
    if (error instanceof KycNotVerifiedError) {
      return jsonError("kyc_not_verified", error.message, 403);
    }
    if (error instanceof ConcurrentModificationError) {
      return jsonError("concurrent_modification", error.message, 409);
    }
    // "Transfer <id> is not in CREATED state" — state mismatch
    const message =
      error instanceof Error ? error.message : "PayID issuance failed";
    if (/is not in CREATED state/.test(message)) {
      return jsonError("transfer_invalid_state", message, 409);
    }
    log("error", "transfers.issue_payid.failed", {
      transferId: typeof transferId === "string" ? transferId : undefined,
      error,
    });
    return jsonError(
      "payid_issue_failed",
      "PayID is temporarily unavailable. Please try again shortly.",
      500,
    );
  }
}
