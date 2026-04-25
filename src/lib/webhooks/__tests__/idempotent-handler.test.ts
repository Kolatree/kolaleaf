import { describe, it, expect, vi, beforeEach } from 'vitest'
import { processWebhookEvent } from '../idempotent-handler'

vi.mock('../../../generated/prisma/client', () => {
  class PrismaClientKnownRequestError extends Error {
    code: string
    constructor(message: string, opts: { code: string }) {
      super(message)
      this.code = opts.code
    }
  }
  return {
    Prisma: {
      PrismaClientKnownRequestError,
    },
  }
})

vi.mock('../../db/client', () => ({
  prisma: {
    webhookEvent: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}))

import { prisma } from '../../db/client'
import { Prisma } from '../../../generated/prisma/client'

const baseOpts = {
  provider: 'TEST_PROVIDER',
  eventId: 'evt-001',
  eventType: 'test.event',
  payload: { foo: 'bar' },
}

describe('processWebhookEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('claims, processes, and marks processed on success', async () => {
    vi.mocked(prisma.webhookEvent.create).mockResolvedValue({} as any)
    vi.mocked(prisma.webhookEvent.update).mockResolvedValue({} as any)
    const processFn = vi.fn().mockResolvedValue(undefined)

    await processWebhookEvent({ ...baseOpts, process: processFn })

    expect(prisma.webhookEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: 'TEST_PROVIDER',
        eventId: 'evt-001',
        eventType: 'test.event',
        processed: false,
      }),
    })
    expect(processFn).toHaveBeenCalledOnce()
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith({
      where: { provider_eventId: { provider: 'TEST_PROVIDER', eventId: 'evt-001' } },
      data: expect.objectContaining({ processed: true }),
    })
    expect(prisma.webhookEvent.delete).not.toHaveBeenCalled()
  })

  it('short-circuits on P2002 duplicate (idempotency)', async () => {
    vi.mocked(prisma.webhookEvent.create).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002' } as any)
    )
    const processFn = vi.fn()

    await processWebhookEvent({ ...baseOpts, process: processFn })

    expect(processFn).not.toHaveBeenCalled()
    expect(prisma.webhookEvent.update).not.toHaveBeenCalled()
    expect(prisma.webhookEvent.delete).not.toHaveBeenCalled()
  })

  it('re-throws non-P2002 errors from claim insert', async () => {
    vi.mocked(prisma.webhookEvent.create).mockRejectedValue(
      new Error('Connection refused')
    )
    const processFn = vi.fn()

    await expect(
      processWebhookEvent({ ...baseOpts, process: processFn })
    ).rejects.toThrow('Connection refused')

    expect(processFn).not.toHaveBeenCalled()
  })

  it('releases lock on transient error (no isPermanentError)', async () => {
    vi.mocked(prisma.webhookEvent.create).mockResolvedValue({} as any)
    vi.mocked(prisma.webhookEvent.delete).mockResolvedValue({} as any)
    const processFn = vi.fn().mockRejectedValue(new Error('DB timeout'))

    await expect(
      processWebhookEvent({ ...baseOpts, process: processFn })
    ).rejects.toThrow('DB timeout')

    expect(prisma.webhookEvent.delete).toHaveBeenCalledWith({
      where: { provider_eventId: { provider: 'TEST_PROVIDER', eventId: 'evt-001' } },
    })
    expect(prisma.webhookEvent.update).not.toHaveBeenCalled()
  })

  it('keeps lock and marks processed on permanent error', async () => {
    vi.mocked(prisma.webhookEvent.create).mockResolvedValue({} as any)
    vi.mocked(prisma.webhookEvent.update).mockResolvedValue({} as any)

    class PermanentError extends Error {}
    const processFn = vi.fn().mockRejectedValue(new PermanentError('Bad data'))

    await expect(
      processWebhookEvent({
        ...baseOpts,
        process: processFn,
        isPermanentError: (err) => err instanceof PermanentError,
      })
    ).rejects.toThrow('Bad data')

    expect(prisma.webhookEvent.update).toHaveBeenCalledWith({
      where: { provider_eventId: { provider: 'TEST_PROVIDER', eventId: 'evt-001' } },
      data: expect.objectContaining({
        processed: true,
        payload: expect.objectContaining({ processingError: 'Bad data' }),
      }),
    })
    expect(prisma.webhookEvent.delete).not.toHaveBeenCalled()
  })

  it('releases lock when isPermanentError returns false', async () => {
    vi.mocked(prisma.webhookEvent.create).mockResolvedValue({} as any)
    vi.mocked(prisma.webhookEvent.delete).mockResolvedValue({} as any)
    const processFn = vi.fn().mockRejectedValue(new Error('Transient fail'))

    await expect(
      processWebhookEvent({
        ...baseOpts,
        process: processFn,
        isPermanentError: () => false,
      })
    ).rejects.toThrow('Transient fail')

    expect(prisma.webhookEvent.delete).toHaveBeenCalled()
    expect(prisma.webhookEvent.update).not.toHaveBeenCalled()
  })
})
