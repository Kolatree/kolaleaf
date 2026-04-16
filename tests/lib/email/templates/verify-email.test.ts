import { describe, it, expect } from 'vitest'
import { renderVerificationEmail } from '@/lib/email/templates/verify-email'

describe('renderVerificationEmail', () => {
  it('returns subject, html, text', () => {
    const out = renderVerificationEmail({
      recipientName: 'Ambrose',
      code: '123456',
      expiresInMinutes: 30,
    })
    expect(out.subject).toBeTruthy()
    expect(out.html).toBeTruthy()
    expect(out.text).toBeTruthy()
  })

  it('includes the code in subject, html, and text', () => {
    const code = '987654'
    const out = renderVerificationEmail({
      recipientName: 'Ada',
      code,
      expiresInMinutes: 30,
    })
    expect(out.subject).toContain(code)
    expect(out.html).toContain(code)
    expect(out.text).toContain(code)
  })

  it('includes the recipient name', () => {
    const out = renderVerificationEmail({
      recipientName: 'Grace',
      code: '111111',
      expiresInMinutes: 30,
    })
    expect(out.html).toContain('Grace')
    expect(out.text).toContain('Grace')
  })

  it('mentions the expiry window in minutes', () => {
    const out = renderVerificationEmail({
      recipientName: 'Ada',
      code: '111111',
      expiresInMinutes: 30,
    })
    expect(out.text).toMatch(/30 minutes/)
  })

  it('escapes HTML in recipient name to prevent injection', () => {
    const out = renderVerificationEmail({
      recipientName: '<script>alert(1)</script>',
      code: '111111',
      expiresInMinutes: 30,
    })
    expect(out.html).not.toContain('<script>alert(1)</script>')
    expect(out.html).toContain('&lt;script&gt;')
  })
})
