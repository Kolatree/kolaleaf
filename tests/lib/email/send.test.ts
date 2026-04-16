import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock resend SDK
const mockSend = vi.fn()
vi.mock('resend', () => ({
  Resend: function ResendMock() {
    return { emails: { send: mockSend } }
  },
}))

describe('sendEmail', () => {
  beforeEach(() => {
    vi.resetModules()
    mockSend.mockReset()
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('in dev (no API key) console.logs the email with [email-dev] prefix and returns ok', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('EMAIL_FROM', 'Kolaleaf <noreply@kolaleaf.com>')

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { sendEmail } = await import('@/lib/email/send')
    const result = await sendEmail({
      to: 'user@test.com',
      subject: 'Hi',
      html: '<p>hi</p>',
      text: 'hi',
    })

    expect(result.ok).toBe(true)
    expect(logSpy).toHaveBeenCalled()
    const firstLog = logSpy.mock.calls[0].join(' ')
    expect(firstLog).toContain('[email-dev]')
    logSpy.mockRestore()
  })

  it('when API key present, calls Resend.emails.send', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test_key')
    vi.stubEnv('EMAIL_FROM', 'Kolaleaf <noreply@kolaleaf.com>')
    vi.stubEnv('NODE_ENV', 'production')

    mockSend.mockResolvedValue({ data: { id: 'evt_123' }, error: null })

    const { sendEmail } = await import('@/lib/email/send')
    const result = await sendEmail({
      to: 'user@test.com',
      subject: 'Hello',
      html: '<p>hello</p>',
      text: 'hello',
    })

    expect(mockSend).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(true)
    expect(result.id).toBe('evt_123')
  })

  it('returns ok:false when Resend returns an error', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test_key')
    vi.stubEnv('EMAIL_FROM', 'Kolaleaf <noreply@kolaleaf.com>')
    vi.stubEnv('NODE_ENV', 'production')

    mockSend.mockResolvedValue({ data: null, error: { message: 'bad' } })

    const { sendEmail } = await import('@/lib/email/send')
    const result = await sendEmail({
      to: 'user@test.com',
      subject: 'Hello',
      html: '<p>hello</p>',
      text: 'hello',
    })

    expect(result.ok).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('importing the client in production with missing RESEND_API_KEY does NOT throw (lazy)', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('EMAIL_FROM', 'Kolaleaf <noreply@kolaleaf.com>')

    // LAZY validation: import is side-effect-free so `next build` can collect
    // page data for routes that transitively import this module without env
    // vars wired up yet. The throw is deferred to first send-attempt below.
    await expect(import('@/lib/email/client')).resolves.toBeDefined()
  })

  it('in production sendEmail throws on first call when RESEND_API_KEY is missing', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('EMAIL_FROM', 'Kolaleaf <noreply@kolaleaf.com>')

    const { sendEmail } = await import('@/lib/email/send')
    await expect(
      sendEmail({ to: 'x@x.com', subject: 'hi', html: '<p>hi</p>', text: 'hi' }),
    ).rejects.toThrow(/RESEND_API_KEY/)
  })

  it('in production sendEmail throws on first call when EMAIL_FROM is missing', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test_key')
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('EMAIL_FROM', '')

    const { sendEmail } = await import('@/lib/email/send')
    await expect(
      sendEmail({ to: 'x@x.com', subject: 'hi', html: '<p>hi</p>', text: 'hi' }),
    ).rejects.toThrow(/EMAIL_FROM/)
  })
})
