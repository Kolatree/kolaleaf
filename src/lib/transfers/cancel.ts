import { prisma } from "../db/client";
import { transitionTransfer } from "./state-machine";
import {
  TransferNotFoundError,
  NotTransferOwnerError,
  CancelTooLateError,
} from "./errors";
import { TransferStatus, ActorType } from "../../generated/prisma/enums";
import type { Transfer } from "../../generated/prisma/client";

// Past these states the AUD has already been received from the
// customer and we owe them value back via refund — cancellation is
// no longer the correct remedy. Keeping this set here (rather than
// inferring from VALID_TRANSITIONS) makes the cancel-window
// boundary explicit.
const NON_CANCELLABLE_AFTER: ReadonlySet<TransferStatus> =
  new Set<TransferStatus>([
    TransferStatus.AUD_RECEIVED,
    TransferStatus.PROCESSING_NGN,
    TransferStatus.FLOAT_INSUFFICIENT,
    TransferStatus.NGN_SENT,
    TransferStatus.NGN_FAILED,
    TransferStatus.NGN_RETRY,
    TransferStatus.NEEDS_MANUAL,
    TransferStatus.COMPLETED,
    TransferStatus.REFUNDED,
  ]);

interface CancelParams {
  transferId: string;
  userId: string;
}

export async function cancelTransfer(params: CancelParams): Promise<Transfer> {
  const { transferId, userId } = params;

  // Pre-flight: ownership and cancel-window checks before delegating
  // to the state machine. These are cancel-specific business rules
  // that don't belong in the generic transitionTransfer.
  const transfer = await prisma.transfer.findUnique({
    where: { id: transferId },
  });
  if (!transfer) throw new TransferNotFoundError(transferId);

  if (transfer.userId !== userId) {
    throw new NotTransferOwnerError(transferId, userId);
  }

  const fromStatus = transfer.status as TransferStatus;

  // ADV-P9-C1 idempotent repeat-cancel: a second cancel against an
  // already-CANCELLED transfer is a network retry, not a state-machine
  // breach. Return the existing row so the client (which is the same
  // user resubmitting after a flaky connection) sees a 200 with the
  // canonical CANCELLED state instead of a 409 InvalidTransition.
  if (fromStatus === TransferStatus.CANCELLED) {
    return transfer;
  }

  // Step 31 / audit gap #19: give a user-friendly error when
  // cancel is attempted too late (post-AUD). Terminal states
  // (EXPIRED, REFUNDED, COMPLETED) fall through — COMPLETED /
  // REFUNDED are caught by NON_CANCELLABLE_AFTER above and surface
  // as CancelTooLate, EXPIRED falls through to transitionTransfer
  // which throws InvalidTransitionError.
  if (NON_CANCELLABLE_AFTER.has(fromStatus)) {
    throw new CancelTooLateError(transferId, fromStatus);
  }

  return transitionTransfer({
    transferId,
    toStatus: TransferStatus.CANCELLED,
    actor: ActorType.USER,
    actorId: userId,
    expectedStatus: fromStatus,
  });
}
