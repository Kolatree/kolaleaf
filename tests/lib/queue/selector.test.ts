import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('bullmq', () => {
  class Queue {
    add = vi.fn()
    close = vi.fn()
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
  getWebhookDispatcher,
  __resetWebhookDispatcher,
} from '@/lib/queue'
import { InProcessDispatcher } from '@/lib/queue/in-process-dispatcher'
import { BullMQDispatcher } from '@/lib/queue/bullmq-dispatcher'

describe('getWebhookDispatcher', () => {
  const originalRedisUrl = process.env.REDIS_URL

  beforeEach(() => {
    __resetWebhookDispatcher()
  })

  afterEach(() => {
    if (originalRedisUrl === undefined) {
      delete process.env.REDIS_URL
    } else {
      process.env.REDIS_URL = originalRedisUrl
    }
    __resetWebhookDispatcher()
  })

  it('returns an InProcessDispatcher when REDIS_URL is unset', () => {
    delete process.env.REDIS_URL
    const dispatcher = getWebhookDispatcher()
    expect(dispatcher).toBeInstanceOf(InProcessDispatcher)
  })

  it('returns an InProcessDispatcher when REDIS_URL is blank', () => {
    process.env.REDIS_URL = '   '
    const dispatcher = getWebhookDispatcher()
    expect(dispatcher).toBeInstanceOf(InProcessDispatcher)
  })

  it('returns a BullMQDispatcher when REDIS_URL is set', () => {
    process.env.REDIS_URL = 'redis://localhost:6379'
    const dispatcher = getWebhookDispatcher()
    expect(dispatcher).toBeInstanceOf(BullMQDispatcher)
  })

  it('caches the dispatcher across calls', () => {
    delete process.env.REDIS_URL
    const a = getWebhookDispatcher()
    const b = getWebhookDispatcher()
    expect(a).toBe(b)
  })

  it('re-evaluates REDIS_URL after reset', () => {
    delete process.env.REDIS_URL
    const first = getWebhookDispatcher()
    expect(first).toBeInstanceOf(InProcessDispatcher)

    __resetWebhookDispatcher()
    process.env.REDIS_URL = 'redis://localhost:6379'
    const second = getWebhookDispatcher()
    expect(second).toBeInstanceOf(BullMQDispatcher)
  })
})
