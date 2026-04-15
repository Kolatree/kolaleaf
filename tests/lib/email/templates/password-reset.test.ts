import { describe, it, expect } from 'vitest'
import { renderPasswordResetEmail } from '@/lib/email/templates/password-reset'

describe('renderPasswordResetEmail', () => {
  it('returns subject, html, text', () => {
    const out = renderPasswordResetEmail({
      recipientName: 'Ada',
      resetUrl: 'https://kolaleaf.com/reset?token=abc',
      expiresInMinutes: 60,
    })
    expect(out.subject).toBeTruthy()
    expect(out.html).toBeTruthy()
    expect(out.text).toBeTruthy()
  })

  it('includes the reset URL', () => {
    const url = 'https://kolaleaf.com/reset?token=pqr'
    const out = renderPasswordResetEmail({
      recipientName: 'Ada',
      resetUrl: url,
      expiresInMinutes: 60,
    })
    expect(out.html).toContain(url)
    expect(out.text).toContain(url)
  })

  it('shows IP and user-agent when provided', () => {
    const out = renderPasswordResetEmail({
      recipientName: 'Ada',
      resetUrl: 'https://example.com/r',
      expiresInMinutes: 60,
      ip: '203.0.113.42',
      userAgent: 'Mozilla/5.0 TestUA',
    })
    expect(out.text).toContain('203.0.113.42')
    expect(out.text).toMatch(/Mozilla/)
  })

  it('works when ip/userAgent omitted', () => {
    const out = renderPasswordResetEmail({
      recipientName: 'Ada',
      resetUrl: 'https://example.com/r',
      expiresInMinutes: 60,
    })
    expect(out.text).toBeTruthy()
    expect(out.html).toBeTruthy()
  })

  it('mentions the expiry window', () => {
    const out = renderPasswordResetEmail({
      recipientName: 'Ada',
      resetUrl: 'https://example.com/r',
      expiresInMinutes: 60,
    })
    expect(out.text).toMatch(/60/)
  })
})
