// Money-path duplicate-suppression for POST /api/v1/transfers.
//
// Contract (matches iOS `TransferSubmissionService`):
//   • Client may send `Idempotency-Key: <uuid>` header per slide-confirm
//     intent. Key persists across transport retries of the same intent.
//   • A (userId, key) pair maps to exactly one Transfer.
//   • Replay with the SAME body → return the existing Transfer (200).
//   • Replay with a DIFFERENT body → 409 idempotency_key_conflict.
//   • No key → fall through to a normal create.
//
// AUSTRAC: dedup returns the original Transfer row. Its initial
// TransferEvent (NULL_STATE → CREATED) is already in the audit log;
// we never create a second audit row on replay.

import { createHash } from "node:crypto";
import type Decimal from "decimal.js";
import { prisma } from "../db/client";
import type { Transfer } from "../../generated/prisma/client";

export class IdempotencyKeyConflictError extends Error {
  constructor(key: string) {
    super(
      `Idempotency key ${key} was used previously with a different request body`,
    );
    this.name = "IdempotencyKeyConflictError";
  }
}

export interface IdempotencyRequestShape {
  recipientId: string;
  corridorId: string;
  sendAmount: Decimal | string;
  exchangeRate: Decimal | string;
  fee: Decimal | string;
}

/// Canonical hash of the create-transfer request body. Stable across
/// JSON formatting differences because we feed each field by its
/// `.toString()` (Decimal → fixed-point string, string → unchanged).
export function hashRequest(req: IdempotencyRequestShape): string {
  const parts = [
    req.recipientId,
    req.corridorId,
    req.sendAmount.toString(),
    req.exchangeRate.toString(),
    req.fee.toString(),
  ].join("|");
  return createHash("sha256").update(parts).digest("hex");
}

/// Returns the cached Transfer for `(userId, key)` IFF the body matches
/// the previously-recorded request hash. Returns `null` when no record
/// exists. Throws `IdempotencyKeyConflictError` on hash mismatch.
export async function findIdempotentTransfer(params: {
  userId: string;
  key: string;
  requestHash: string;
}): Promise<Transfer | null> {
  const { userId, key, requestHash } = params;

  const record = await prisma.idempotencyRecord.findUnique({
    where: { userId_key: { userId, key } },
  });
  if (!record) return null;

  if (record.requestHash !== requestHash) {
    throw new IdempotencyKeyConflictError(key);
  }

  // Body matches a prior submission — replay the original Transfer.
  // findUnique not findUniqueOrThrow because a defensive null surface
  // (transfer row deleted) is treated like a cache miss; create flow
  // proceeds and writes a fresh idempotency record.
  const transfer = await prisma.transfer.findUnique({
    where: { id: record.transferId },
  });
  return transfer;
}

/// Persist the (userId, key) → transferId mapping. Called inside the
/// same Prisma transaction as the Transfer create so a partial commit
/// is impossible. On a unique-violation (two concurrent requests with
/// the same key race), the caller catches the Prisma P2002 error and
/// re-runs `findIdempotentTransfer` to claim the winner's row.
export async function recordIdempotencyKey(params: {
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
  userId: string;
  key: string;
  transferId: string;
  requestHash: string;
}): Promise<void> {
  const { tx, userId, key, transferId, requestHash } = params;
  await tx.idempotencyRecord.create({
    data: { userId, key, transferId, requestHash },
  });
}
