import { prisma } from '@/lib/db/client'
import { Prisma } from '@/generated/prisma/client'

interface LogAuthEventParams {
  userId: string
  event: string
  ip?: string
  metadata?: Record<string, unknown>
}

// Minimal shape of a Prisma transaction client we need for audit writes.
// Using a structural type keeps this module from depending on the full
// `Prisma.TransactionClient` (which drags in the generated schema) and
// lets callers pass either `prisma` or a `tx` handle.
type AuthEventWriter = {
  authEvent: { create: typeof prisma.authEvent.create }
}

// Log one AuthEvent. Accepts an optional transaction client so callers
// inside $transaction callbacks can keep the audit write atomic with
// whatever state change it records (e.g. /api/auth/complete-registration
// writes REGISTER + LOGIN inside the tx that creates the User). When
// `client` is omitted, writes go through the top-level prisma instance.
export async function logAuthEvent(
  params: LogAuthEventParams,
  client: AuthEventWriter = prisma,
): Promise<void> {
  await client.authEvent.create({
    data: {
      userId: params.userId,
      event: params.event,
      ip: params.ip,
      metadata: params.metadata
        ? (params.metadata as Prisma.InputJsonValue)
        : Prisma.NullableJsonNullValueInput.DbNull,
    },
  })
}

// Log many AuthEvents in one round-trip. The tx variant of the
// complete-registration path uses this for the REGISTER + LOGIN pair
// emitted when a wizard finishes — halving DB round-trips and shrinking
// the row-lock hold time.
export async function logAuthEventsMany(
  events: LogAuthEventParams[],
  client: { authEvent: { createMany: typeof prisma.authEvent.createMany } } = prisma,
): Promise<void> {
  if (events.length === 0) return
  await client.authEvent.createMany({
    data: events.map((p) => ({
      userId: p.userId,
      event: p.event,
      ip: p.ip,
      metadata: p.metadata
        ? (p.metadata as Prisma.InputJsonValue)
        : Prisma.NullableJsonNullValueInput.DbNull,
    })),
  })
}
