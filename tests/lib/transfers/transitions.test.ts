import { describe, it, expect } from 'vitest'
import { TransferStatus } from '../../../src/generated/prisma/enums'
import {
  VALID_TRANSITIONS,
  TERMINAL_STATES,
  isValidTransition,
} from '../../../src/lib/transfers/transitions'

describe('VALID_TRANSITIONS', () => {
  it('defines transitions for all 13 TransferStatus values', () => {
    const allStatuses = Object.values(TransferStatus)
    expect(allStatuses.length).toBe(13)
    for (const status of allStatuses) {
      expect(VALID_TRANSITIONS).toHaveProperty(status)
    }
  })

  it('CREATED can transition to AWAITING_AUD and CANCELLED only', () => {
    expect(VALID_TRANSITIONS.CREATED).toEqual(['AWAITING_AUD', 'CANCELLED'])
  })

  it('AWAITING_AUD can transition to AUD_RECEIVED, EXPIRED, CANCELLED', () => {
    expect(VALID_TRANSITIONS.AWAITING_AUD).toEqual(['AUD_RECEIVED', 'EXPIRED', 'CANCELLED'])
  })

  it('AUD_RECEIVED can transition to PROCESSING_NGN, FLOAT_INSUFFICIENT', () => {
    expect(VALID_TRANSITIONS.AUD_RECEIVED).toEqual(['PROCESSING_NGN', 'FLOAT_INSUFFICIENT'])
  })

  it('FLOAT_INSUFFICIENT can transition to AUD_RECEIVED or PROCESSING_NGN', () => {
    expect(VALID_TRANSITIONS.FLOAT_INSUFFICIENT).toEqual(['AUD_RECEIVED', 'PROCESSING_NGN'])
  })

  it('PROCESSING_NGN can transition to NGN_SENT, NGN_FAILED', () => {
    expect(VALID_TRANSITIONS.PROCESSING_NGN).toEqual(['NGN_SENT', 'NGN_FAILED'])
  })

  it('NGN_SENT can transition to COMPLETED', () => {
    expect(VALID_TRANSITIONS.NGN_SENT).toEqual(['COMPLETED'])
  })

  it('NGN_FAILED can transition to NGN_RETRY, NEEDS_MANUAL', () => {
    expect(VALID_TRANSITIONS.NGN_FAILED).toEqual(['NGN_RETRY', 'NEEDS_MANUAL'])
  })

  it('NGN_RETRY can transition to PROCESSING_NGN, NEEDS_MANUAL', () => {
    expect(VALID_TRANSITIONS.NGN_RETRY).toEqual(['PROCESSING_NGN', 'NEEDS_MANUAL'])
  })

  it('NEEDS_MANUAL can transition to PROCESSING_NGN, REFUNDED', () => {
    expect(VALID_TRANSITIONS.NEEDS_MANUAL).toEqual(['PROCESSING_NGN', 'REFUNDED'])
  })
})

describe('TERMINAL_STATES', () => {
  it('contains COMPLETED, EXPIRED, REFUNDED, CANCELLED', () => {
    expect(TERMINAL_STATES).toEqual(
      expect.arrayContaining(['COMPLETED', 'EXPIRED', 'REFUNDED', 'CANCELLED'])
    )
    expect(TERMINAL_STATES.length).toBe(4)
  })

  it('terminal states have empty transition arrays', () => {
    for (const state of TERMINAL_STATES) {
      expect(VALID_TRANSITIONS[state]).toEqual([])
    }
  })
})

describe('isValidTransition', () => {
  it('returns true for every valid transition', () => {
    for (const [from, targets] of Object.entries(VALID_TRANSITIONS)) {
      for (const to of targets) {
        expect(isValidTransition(from as TransferStatus, to)).toBe(true)
      }
    }
  })

  it('returns false for invalid transitions', () => {
    expect(isValidTransition('CREATED', 'COMPLETED')).toBe(false)
    expect(isValidTransition('CREATED', 'PROCESSING_NGN')).toBe(false)
    expect(isValidTransition('AWAITING_AUD', 'COMPLETED')).toBe(false)
    expect(isValidTransition('PROCESSING_NGN', 'CREATED')).toBe(false)
    expect(isValidTransition('NGN_SENT', 'NGN_RETRY')).toBe(false)
  })

  it('returns false for transitions out of terminal states', () => {
    const terminalStates: TransferStatus[] = ['COMPLETED', 'EXPIRED', 'REFUNDED', 'CANCELLED']
    const allStatuses = Object.values(TransferStatus)
    for (const terminal of terminalStates) {
      for (const target of allStatuses) {
        expect(isValidTransition(terminal, target)).toBe(false)
      }
    }
  })

  it('returns false for self-transitions', () => {
    const allStatuses = Object.values(TransferStatus)
    for (const status of allStatuses) {
      expect(isValidTransition(status, status)).toBe(false)
    }
  })
})
