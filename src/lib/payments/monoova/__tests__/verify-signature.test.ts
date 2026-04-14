import { describe, it, expect } from 'vitest'
import crypto from 'crypto'
import { verifyMonoovaSignature } from '../verify-signature'

function sign(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex')
}

describe('verifyMonoovaSignature', () => {
  const secret = 'test-webhook-secret-key'

  it('accepts a valid HMAC-SHA256 signature', () => {
    const payload = JSON.stringify({ event: 'payment.received', amount: 100 })
    const signature = sign(payload, secret)

    expect(verifyMonoovaSignature(payload, signature, secret)).toBe(true)
  })

  it('rejects a tampered payload', () => {
    const original = JSON.stringify({ event: 'payment.received', amount: 100 })
    const tampered = JSON.stringify({ event: 'payment.received', amount: 999 })
    const signature = sign(original, secret)

    expect(verifyMonoovaSignature(tampered, signature, secret)).toBe(false)
  })

  it('rejects an empty signature', () => {
    const payload = JSON.stringify({ event: 'payment.received' })

    expect(verifyMonoovaSignature(payload, '', secret)).toBe(false)
  })

  it('rejects a signature with the wrong secret', () => {
    const payload = JSON.stringify({ event: 'payment.received' })
    const signature = sign(payload, 'wrong-secret')

    expect(verifyMonoovaSignature(payload, signature, secret)).toBe(false)
  })

  it('handles unicode payload correctly', () => {
    const payload = JSON.stringify({ name: 'Tèst Üser', amount: 50 })
    const signature = sign(payload, secret)

    expect(verifyMonoovaSignature(payload, signature, secret)).toBe(true)
  })
})
