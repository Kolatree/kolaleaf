export class InvalidTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Invalid transition from ${from} to ${to}`)
    this.name = 'InvalidTransitionError'
  }
}

export class ConcurrentModificationError extends Error {
  constructor(transferId: string) {
    super(`Transfer ${transferId} was modified concurrently`)
    this.name = 'ConcurrentModificationError'
  }
}

export class TransferNotFoundError extends Error {
  constructor(transferId: string) {
    super(`Transfer ${transferId} not found`)
    this.name = 'TransferNotFoundError'
  }
}

export class KycNotVerifiedError extends Error {
  constructor(userId: string) {
    super(`User ${userId} KYC is not verified`)
    this.name = 'KycNotVerifiedError'
  }
}

export class InvalidCorridorError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidCorridorError'
  }
}

export class AmountOutOfRangeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AmountOutOfRangeError'
  }
}

export class DailyLimitExceededError extends Error {
  constructor(userId: string, limit: string, attempted: string) {
    super(`User ${userId} daily limit ${limit} exceeded (attempted total: ${attempted})`)
    this.name = 'DailyLimitExceededError'
  }
}

export class RecipientNotOwnedError extends Error {
  constructor(recipientId: string, userId: string) {
    super(`Recipient ${recipientId} does not belong to user ${userId}`)
    this.name = 'RecipientNotOwnedError'
  }
}

export class NotTransferOwnerError extends Error {
  constructor(transferId: string, userId: string) {
    super(`User ${userId} does not own transfer ${transferId}`)
    this.name = 'NotTransferOwnerError'
  }
}
