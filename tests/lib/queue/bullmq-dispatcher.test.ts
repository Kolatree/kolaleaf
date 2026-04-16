import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'

const addMock = vi.fn()
const closeMock = vi.fn()
const QueueCtor = vi.fn()

vi.mock('bullmq', () => {
  class Queue {
    add = addMock
    close = closeMock
    constructor(...args: unknown[]) {
      QueueCtor(...args)
    }
  }
  return { Queue }
})

vi.mock('ioredis', () => {
  class FakeRedis {
    constructor() {
      return { __redis: true }
    }
  }
  return { default: FakeRedis, Redis: FakeRedis }
})

import {
  BullMQDispatcher,
  WEBHOOK_JOB_OPTS,
  createRedisConnection,
} from '@/lib/queue/bullmq-dispatcher'
import { WEBHOOK_QUEUE_NAME } from '@/lib/queue/webhook-dispatcher'

describe('BullMQDispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a Queue named "webhooks" on construction', () => {
    new BullMQDispatcher('redis://localhost:6379')
    expect(QueueCtor).toHaveBeenCalledWith(
      WEBHOOK_QUEUE_NAME,
      expect.objectContaining({ connection: expect.anything() }),
    )
  })

  it('enqueues a job with retry opts and SHA-256 rawBody jobId', async () => {
    const dispatcher = new BullMQDispatcher('redis://localhost:6379')
    const rawBody = '{"eventId":"abc"}'
    const expectedId = crypto.createHash('sha256').update(rawBody).digest('hex')

    await dispatcher.dispatch({
      provider: 'monoova',
      rawBody,
      signature: 'sig',
      receivedAt: '2026-04-15T00:00:00.000Z',
    })

    expect(addMock).toHaveBeenCalledOnce()
    const [name, payload, opts] = addMock.mock.calls[0]
    expect(name).toBe('monoova')
    expect(payload).toEqual({
      provider: 'monoova',
      rawBody,
      signature: 'sig',
      receivedAt: '2026-04-15T00:00:00.000Z',
    })
    expect(opts.jobId).toBe(expectedId)
    expect(opts.attempts).toBe(WEBHOOK_JOB_OPTS.attempts)
    expect(opts.backoff).toEqual(WEBHOOK_JOB_OPTS.backoff)
    expect(opts.removeOnComplete).toBe(WEBHOOK_JOB_OPTS.removeOnComplete)
    expect(opts.removeOnFail).toBe(WEBHOOK_JOB_OPTS.removeOnFail)
  })

  it('uses the provider as the job name (for per-provider metrics)', async () => {
    const dispatcher = new BullMQDispatcher('redis://localhost:6379')
    await dispatcher.dispatch({
      provider: 'flutterwave',
      rawBody: '{}',
      signature: 's',
      receivedAt: '2026-04-15T00:00:00.000Z',
    })
    expect(addMock.mock.calls[0][0]).toBe('flutterwave')
  })

  it('produces stable jobIds for identical rawBody (dedup at the queue)', async () => {
    const dispatcher = new BullMQDispatcher('redis://localhost:6379')
    const rawBody = '{"eventId":"same"}'

    await dispatcher.dispatch({
      provider: 'monoova',
      rawBody,
      signature: 'a',
      receivedAt: '2026-04-15T00:00:00.000Z',
    })
    await dispatcher.dispatch({
      provider: 'monoova',
      rawBody,
      signature: 'b',
      receivedAt: '2026-04-15T00:00:01.000Z',
    })

    const id1 = addMock.mock.calls[0][2].jobId
    const id2 = addMock.mock.calls[1][2].jobId
    expect(id1).toBe(id2)
  })

  it('createRedisConnection builds an ioredis instance from a URL', () => {
    const conn = createRedisConnection('redis://localhost:6379')
    expect(conn).toBeDefined()
  })

  it('accepts an existing ioredis connection', () => {
    const existing = createRedisConnection('redis://localhost:6379')
    new BullMQDispatcher(existing)
    expect(QueueCtor).toHaveBeenCalledWith(
      WEBHOOK_QUEUE_NAME,
      expect.objectContaining({ connection: existing }),
    )
  })

  it('close() closes the underlying queue', async () => {
    const dispatcher = new BullMQDispatcher('redis://localhost:6379')
    closeMock.mockResolvedValue(undefined)
    await dispatcher.close()
    expect(closeMock).toHaveBeenCalledOnce()
  })
})
