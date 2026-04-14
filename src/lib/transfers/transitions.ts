import { TransferStatus } from '../../generated/prisma/enums'

export const VALID_TRANSITIONS: Record<TransferStatus, TransferStatus[]> = {
  CREATED:            ['AWAITING_AUD', 'CANCELLED'],
  AWAITING_AUD:       ['AUD_RECEIVED', 'EXPIRED', 'CANCELLED'],
  AUD_RECEIVED:       ['PROCESSING_NGN', 'FLOAT_INSUFFICIENT'],
  FLOAT_INSUFFICIENT: ['AUD_RECEIVED', 'PROCESSING_NGN'],
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
