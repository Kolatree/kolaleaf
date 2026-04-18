import { TransferStatus } from '../../generated/prisma/enums'

export const VALID_TRANSITIONS: Record<TransferStatus, TransferStatus[]> = {
  // NULL_STATE is a sentinel for the initial TransferEvent.fromStatus
  // only — a Transfer row never occupies it, so it has no legal
  // outbound transitions at the state-machine level.
  NULL_STATE:         [],
  CREATED:            ['AWAITING_AUD', 'CANCELLED'],
  AWAITING_AUD:       ['AUD_RECEIVED', 'EXPIRED', 'CANCELLED'],
  AUD_RECEIVED:       ['PROCESSING_NGN', 'FLOAT_INSUFFICIENT'],
  // Step 31 / audit gap #10: resume only targets AUD_RECEIVED — the
  // float monitor puts the transfer back where it was paused from.
  // The old FLOAT_INSUFFICIENT -> PROCESSING_NGN edge was dead; no
  // code triggered it, so removing it preserves the legal surface.
  FLOAT_INSUFFICIENT: ['AUD_RECEIVED'],
  PROCESSING_NGN:     ['NGN_SENT', 'NGN_FAILED'],
  NGN_SENT:           ['COMPLETED'],
  NGN_FAILED:         ['NGN_RETRY', 'NEEDS_MANUAL'],
  NGN_RETRY:          ['PROCESSING_NGN', 'NEEDS_MANUAL'],
  NEEDS_MANUAL:       ['PROCESSING_NGN', 'REFUNDED'],
  COMPLETED:          [],
  EXPIRED:            [],
  REFUNDED:           [],
  CANCELLED:          [],
}

export const TERMINAL_STATES: TransferStatus[] = (
  Object.entries(VALID_TRANSITIONS) as [TransferStatus, TransferStatus[]][]
)
  .filter(([, targets]) => targets.length === 0)
  .map(([state]) => state)

export function isValidTransition(from: TransferStatus, to: TransferStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to)
}
