import { describe, it, expect } from 'vitest'
import crypto from 'crypto'
import { verifySumsubSignature } from '../verify-signature'

function sign(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex')
}

describe('verifySumsubSignature', () => {
  const secret = 'test-sumsub-webhook-secret'

  it('accepts a valid HMAC-SHA256 signature', () => {
    const payload = JSON.stringify({ type: 'applicantReviewed', applicantId: 'abc-123' })
    const signature = sign(payload, secret)

    expect(verifySumsubSignature(payload, signature, secret)).toBe(true)
  })

  it('rejects a tampered payload', () => {
    const original = JSON.stringify({ type: 'applicantReviewed', applicantId: 'abc-123' })
    const tampered = JSON.stringify({ type: 'applicantReviewed', applicantId: 'abc-HACKED' })
    const signature = sign(original, secret)

    expect(verifySumsubSignature(tampered, signature, secret)).toBe(false)
  })

  it('rejects an empty signature', () => {
    const payload = JSON.stringify({ type: 'applicantReviewed' })

    expect(verifySumsubSignature(payload, '', secret)).toBe(false)
  })

  it('rejects a signature with the wrong secret', () => {
    const payload = JSON.stringify({ type: 'applicantReviewed' })
    const signature = sign(payload, 'wrong-secret')

    expect(verifySumsubSignature(payload, signature, secret)).toBe(false)
  })

  it('handles unicode payload correctly', () => {
    const payload = JSON.stringify({ fullName: 'Tèst Üser', applicantId: 'abc-123' })
    const signature = sign(payload, secret)

    expect(verifySumsubSignature(payload, signature, secret)).toBe(true)
  })
})
