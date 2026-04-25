import { Prisma } from '../../generated/prisma/client'
import { prisma } from '../db/client'

// Shared create-as-lock idempotency skeleton for all webhook handlers.
//
// The first delivery for a given (provider, eventId) claims a WebhookEvent
// row via a unique-constraint-protected insert. A concurrent duplicate
// delivery hits P2002 on the create and returns immediately, so the
// business logic runs at most once.
//
// On success the row is marked processed. On transient failure the lock
// is released (row deleted) so the provider's retry can re-enter. On
// permanent failure the row is kept (with the error message) so retries
// are blocked and the issue surfaces in reconciliation.
export async function processWebhookEvent(opts: {
  provider: string
  eventId: string
  eventType: string
  payload: unknown
  process: () => Promise<void>
  isPermanentError?: (err: unknown) => boolean
}): Promise<void> {
  const { provider, eventId, eventType, payload, process, isPermanentError } = opts
  const whereKey = { provider_eventId: { provider, eventId } }

  // 1. Atomically claim the event. If another delivery already claimed
  //    it, short-circuit.
  try {
    await prisma.webhookEvent.create({
      data: {
        provider,
        eventId,
        eventType,
        payload: payload as object,
        processed: false,
      },
    })
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      // Duplicate delivery; another worker already owns this eventId.
      return
    }
    throw err
  }

  // 2. Run the caller's business logic.
  try {
    await process()
  } catch (err) {
    const permanent = isPermanentError?.(err) ?? false

    if (permanent) {
      // Keep the webhook event as a processed-with-error record so
      // retries are blocked and the issue surfaces in reconciliation.
      await prisma.webhookEvent.update({
        where: whereKey,
        data: {
          processed: true,
          processedAt: new Date(),
          payload: {
            ...(payload as object),
            processingError: err instanceof Error ? err.message : String(err),
          },
        },
      })
      throw err
    }

    // Transient: release the lock for provider retry.
    await prisma.webhookEvent.delete({ where: whereKey })
    throw err
  }

  // 3. Mark processed on success.
  await prisma.webhookEvent.update({
    where: whereKey,
    data: { processed: true, processedAt: new Date() },
  })
}
