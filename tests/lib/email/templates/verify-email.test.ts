import { describe, it, expect } from 'vitest'
import { renderVerificationEmail } from '@/lib/email/templates/verify-email'

describe('renderVerificationEmail', () => {
  it('returns subject, html, text', () => {
    const out = renderVerificationEmail({
      recipientName: 'Ambrose',
      verificationUrl: 'https://kolaleaf.com/verify?token=abc',
      expiresInHours: 24,
    })
    expect(out.subject).toBeTruthy()
    expect(out.html).toBeTruthy()
    expect(out.text).toBeTruthy()
  })

  it('includes the verification URL in both html and text', () => {
    const url = 'https://kolaleaf.com/verify?token=xyz789'
    const out = renderVerificationEmail({
      recipientName: 'Ada',
      verificationUrl: url,
      expiresInHours: 24,
    })
    expect(out.html).toContain(url)
    expect(out.text).toContain(url)
  })

  it('includes the recipient name', () => {
    const out = renderVerificationEmail({
      recipientName: 'Grace',
      verificationUrl: 'https://example.com/v',
      expiresInHours: 24,
    })
    expect(out.html).toContain('Grace')
    expect(out.text).toContain('Grace')
  })

  it('mentions the expiry window', () => {
    const out = renderVerificationEmail({
      recipientName: 'Ada',
      verificationUrl: 'https://example.com/v',
      expiresInHours: 24,
    })
    expect(out.text).toMatch(/24/)
  })
})
