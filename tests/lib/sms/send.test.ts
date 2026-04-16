import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock twilio SDK at the module level. The constructor returns an object with
// `messages.create()` — same shape the SDK exposes.
const mockCreate = vi.fn()
vi.mock('twilio', () => ({
  default: function TwilioMock() {
    return { messages: { create: mockCreate } }
  },
}))

describe('sendSms', () => {
  beforeEach(() => {
    vi.resetModules()
    mockCreate.mockReset()
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('in dev (no Twilio env) console.logs with [sms-dev] prefix and returns ok', async () => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', '')
    vi.stubEnv('TWILIO_AUTH_TOKEN', '')
    vi.stubEnv('TWILIO_FROM_NUMBER', '')
    vi.stubEnv('NODE_ENV', 'development')

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { sendSms } = await import('@/lib/sms/send')
    const result = await sendSms({ to: '+61400000000', body: 'Your code is 123456' })

    expect(result.ok).toBe(true)
    expect(logSpy).toHaveBeenCalled()
    const joined = logSpy.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(joined).toContain('[sms-dev]')
    expect(joined).toContain('+61400000000')
    logSpy.mockRestore()
  })

  it('when Twilio creds present, calls twilio.messages.create', async () => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC_test')
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'token_test')
    vi.stubEnv('TWILIO_FROM_NUMBER', '+15005550006')
    vi.stubEnv('NODE_ENV', 'production')

    mockCreate.mockResolvedValue({ sid: 'SM_abc123' })

    const { sendSms } = await import('@/lib/sms/send')
    const result = await sendSms({ to: '+61400000000', body: 'hi' })

    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ to: '+61400000000', from: '+15005550006', body: 'hi' }),
    )
    expect(result.ok).toBe(true)
    expect(result.id).toBe('SM_abc123')
  })

  it('never throws on Twilio failure — returns { ok:false, error }', async () => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC_test')
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'token_test')
    vi.stubEnv('TWILIO_FROM_NUMBER', '+15005550006')
    vi.stubEnv('NODE_ENV', 'production')

    mockCreate.mockRejectedValueOnce(new Error('twilio exploded'))

    const { sendSms } = await import('@/lib/sms/send')
    const result = await sendSms({ to: '+61400000000', body: 'hi' })

    expect(result.ok).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('importing the client in production with missing Twilio creds does NOT throw (lazy)', async () => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', '')
    vi.stubEnv('TWILIO_AUTH_TOKEN', '')
    vi.stubEnv('TWILIO_FROM_NUMBER', '')
    vi.stubEnv('NODE_ENV', 'production')

    // LAZY validation: import is side-effect-free so `next build` can collect
    // page data for routes that transitively import this module without env
    // vars wired up yet. The throw is deferred to first sendSms below.
    await expect(import('@/lib/sms/client')).resolves.toBeDefined()
  })

  it('in production sendSms throws on first call when TWILIO_ACCOUNT_SID missing', async () => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', '')
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'token_test')
    vi.stubEnv('TWILIO_FROM_NUMBER', '+15005550006')
    vi.stubEnv('NODE_ENV', 'production')

    const { sendSms } = await import('@/lib/sms/send')
    await expect(sendSms({ to: '+61400000000', body: 'hi' })).rejects.toThrow(
      /TWILIO_ACCOUNT_SID/,
    )
  })

  it('in production sendSms throws on first call when TWILIO_AUTH_TOKEN missing', async () => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC_test')
    vi.stubEnv('TWILIO_AUTH_TOKEN', '')
    vi.stubEnv('TWILIO_FROM_NUMBER', '+15005550006')
    vi.stubEnv('NODE_ENV', 'production')

    const { sendSms } = await import('@/lib/sms/send')
    await expect(sendSms({ to: '+61400000000', body: 'hi' })).rejects.toThrow(
      /TWILIO_AUTH_TOKEN/,
    )
  })

  it('in production sendSms throws on first call when TWILIO_FROM_NUMBER missing', async () => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC_test')
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'token_test')
    vi.stubEnv('TWILIO_FROM_NUMBER', '')
    vi.stubEnv('NODE_ENV', 'production')

    const { sendSms } = await import('@/lib/sms/send')
    await expect(sendSms({ to: '+61400000000', body: 'hi' })).rejects.toThrow(
      /TWILIO_FROM_NUMBER/,
    )
  })
})
