import Decimal from "decimal.js";
import { prisma } from "../db/client";
import {
  InvalidCorridorError,
  AmountOutOfRangeError,
  DailyLimitExceededError,
  RecipientNotOwnedError,
} from "./errors";
import type { Transfer } from "../../generated/prisma/client";
import { FUNDS_COMMITTED_STATUSES } from "./state-machine";
import { recordVelocityCheck } from "../compliance/velocity";
import { recordAustracReports } from "../compliance/austrac-reports";
import { recordSecurityAnomalyCheck } from "../security/anomaly";
import type { RequestContext } from "../security/request-context";
import {
  hashRequest as hashIdempotencyRequest,
  findIdempotentTransfer,
  recordIdempotencyKey,
} from "./idempotency";

interface CreateTransferParams {
  userId: string;
  recipientId: string;
  corridorId: string;
  sendAmount: Decimal;
  exchangeRate: Decimal;
  fee: Decimal;
  // Optional — when supplied, the anomaly detector runs post-commit
  // and attaches any SUSPICIOUS report to this transfer. Omitted in
  // contexts that create transfers outside an HTTP request (cron
  // retries, tests).
  securityContext?: RequestContext;
  // Optional — when supplied, suppresses duplicate creates for the
  // same (userId, idempotencyKey) pair. Replays with a matching body
  // return the cached Transfer; replays with a mismatched body throw
  // IdempotencyKeyConflictError. See `./idempotency.ts`.
  idempotencyKey?: string;
}

// Re-export so callers using `import { … } from '@/lib/transfers/create'`
// can still reach the conflict error without a barrel rewrite.
export { IdempotencyKeyConflictError } from "./idempotency";

export async function createTransfer(
  params: CreateTransferParams,
): Promise<Transfer> {
  const {
    userId,
    recipientId,
    corridorId,
    sendAmount,
    exchangeRate,
    fee,
    securityContext,
    idempotencyKey,
  } = params;

  // Idempotency short-circuit. Runs OUTSIDE the create transaction so
  // we don't burn a writeable connection on a cache hit. The hash
  // covers every field that can change a Transfer's economic shape;
  // a body-mismatch with the same key raises IdempotencyKeyConflictError
  // (which the route maps to 409).
  //
  // AUSTRAC: replays return the ORIGINAL Transfer, which already has
  // its TransferEvent audit row from the initial create. Replay never
  // skips audit; only fresh transfers create new events.
  const requestHash = idempotencyKey
    ? hashIdempotencyRequest({
        recipientId,
        corridorId,
        sendAmount,
        exchangeRate,
        fee,
      })
    : null;
  if (idempotencyKey && requestHash) {
    const cached = await findIdempotentTransfer({
      userId,
      key: idempotencyKey,
      requestHash,
    });
    if (cached) return cached;
  }

  return prisma
    .$transaction(async (tx) => {
      // 1. Validate user exists. KYC is NOT required to create a
      //    transfer — users can draft a CREATED transfer and progress
      //    to the verification wizard afterwards. KYC is enforced at
      //    generatePayIdForTransfer, which is the boundary where we
      //    start collecting AUD. Until that point the Transfer row is
      //    inert: no PayID issued, no AUD held, no AUSTRAC exposure.
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });

      // 2. Validate recipient exists and belongs to user
      const recipient = await tx.recipient.findUnique({
        where: { id: recipientId },
      });
      if (!recipient || recipient.userId !== userId) {
        throw new RecipientNotOwnedError(recipientId, userId);
      }

      // 3. Validate corridor exists and is active
      const corridor = await tx.corridor.findUnique({
        where: { id: corridorId },
      });
      if (!corridor) {
        throw new InvalidCorridorError(`Corridor ${corridorId} not found`);
      }
      if (!corridor.active) {
        throw new InvalidCorridorError(`Corridor ${corridorId} is not active`);
      }

      // 4. Validate sendAmount is within corridor min/max
      const min = new Decimal(corridor.minAmount.toString());
      const max = new Decimal(corridor.maxAmount.toString());
      if (sendAmount.lt(min)) {
        throw new AmountOutOfRangeError(
          `Send amount ${sendAmount} is below minimum ${min} for corridor`,
        );
      }
      if (sendAmount.gt(max)) {
        throw new AmountOutOfRangeError(
          `Send amount ${sendAmount} is above maximum ${max} for corridor`,
        );
      }

      // 5. Validate daily limit
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setUTCHours(23, 59, 59, 999);

      const todaysTransfers = await tx.transfer.findMany({
        where: {
          userId,
          createdAt: { gte: todayStart, lte: todayEnd },
          // Only count transfers where AUD has actually been received.
          // Drafts (CREATED, AWAITING_AUD) should not consume the daily
          // limit — users can abandon them without funds moving.
          status: { in: FUNDS_COMMITTED_STATUSES },
        },
        select: { sendAmount: true },
      });

      const todayTotal = todaysTransfers.reduce(
        (sum, t) => sum.plus(new Decimal(t.sendAmount.toString())),
        new Decimal(0),
      );
      const dailyLimit = new Decimal(user.dailyLimit.toString());
      const projectedTotal = todayTotal.plus(sendAmount);

      if (projectedTotal.gt(dailyLimit)) {
        throw new DailyLimitExceededError(
          userId,
          dailyLimit.toString(),
          projectedTotal.toString(),
        );
      }

      // 6. Calculate receiveAmount
      const receiveAmount = sendAmount.mul(exchangeRate);

      // 7. Create the transfer
      const transfer = await tx.transfer.create({
        data: {
          userId,
          recipientId,
          corridorId,
          sendAmount: sendAmount.toString(),
          receiveAmount: receiveAmount.toString(),
          exchangeRate: exchangeRate.toString(),
          fee: fee.toString(),
          status: "CREATED",
        },
      });

      // 8. Create initial TransferEvent (NULL_STATE -> CREATED). Using
      //    the NULL_STATE sentinel instead of a CREATED -> CREATED self-
      //    transition so AUSTRAC reconciliation tooling sees a monotone
      //    state progression (Step 31 / audit gap #5).
      await tx.transferEvent.create({
        data: {
          transferId: transfer.id,
          fromStatus: "NULL_STATE",
          toStatus: "CREATED",
          actor: "USER",
        },
      });

      // 8a. Record the idempotency mapping inside the same transaction
      //     so a partial commit (transfer written, mapping missing) is
      //     impossible. A concurrent request with the same key hits
      //     the (userId, key) unique index and rolls back here — the
      //     outer catch re-reads the cache and returns the winner's
      //     transfer.
      if (idempotencyKey && requestHash) {
        await recordIdempotencyKey({
          tx,
          userId,
          key: idempotencyKey,
          transferId: transfer.id,
          requestHash,
        });
      }

      return { transfer, corridor };
    })
    .catch(async (error: unknown) => {
      // Race: two concurrent requests with the same (userId, key). The
      // loser hits the unique-index violation and rolls back its insert.
      // Re-read the cache; the winner's row is now visible.
      const isUniqueViolation =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "P2002";
      if (idempotencyKey && requestHash && isUniqueViolation) {
        const cached = await findIdempotentTransfer({
          userId,
          key: idempotencyKey,
          requestHash,
        });
        if (cached) {
          // Re-shape to the `{ transfer, corridor }` envelope the
          // `.then` step expects. We re-fetch the corridor because
          // the compliance side-effects need its currency pair.
          const corridor = await prisma.corridor.findUniqueOrThrow({
            where: { id: corridorId },
          });
          return { transfer: cached, corridor, alreadyExisted: true as const };
        }
      }
      throw error;
    })
    .then(async (result) => {
      const { transfer, corridor } = result;
      // Idempotent replay raced through the catch — skip compliance
      // side-effects (the original create already fired them).
      if ("alreadyExisted" in result && result.alreadyExisted) {
        return transfer;
      }
      // 9. Compliance side-effects run AFTER the transaction commits so
      //    a compliance-pipe failure can't roll back a legitimate
      //    transfer. Each helper swallows its own errors + logs —
      //    belt-and-braces so a customer's transfer succeeds even if
      //    ComplianceReport writes are broken.
      void recordVelocityCheck(userId, transfer.id);
      // AUSTRAC TTR (AUD >= 9,500 buffered) + IFTI (every transfer —
      // all Kolaleaf corridors are cross-border by construction).
      void recordAustracReports({
        userId,
        transferId: transfer.id,
        sendAmountAud: sendAmount,
        baseCurrency: corridor.baseCurrency,
        targetCurrency: corridor.targetCurrency,
      });
      // Security anomaly check (Step 32) — flags transfers initiated
      // from a new country or new device fingerprint relative to the
      // user's 90-day AuthEvent history, AND from a country different
      // from the user's KYC-registered address. Fire-and-forget with
      // a belt-and-braces catch against any synchronous pre-try throw.
      if (securityContext) {
        void recordSecurityAnomalyCheck({
          userId,
          context: securityContext,
          event: "TRANSFER_CREATE",
          transferId: transfer.id,
        }).catch(() => {
          /* logged inside recordSecurityAnomalyCheck */
        });
      }
      return transfer;
    });
}
