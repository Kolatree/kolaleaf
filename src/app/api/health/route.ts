import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { log } from '@/lib/obs/logger'

// GET /api/health
//
// Infra probe. Verifies each dependency the app actually needs:
//   - Postgres (SELECT 1 via Prisma)
//   - Redis  (ping; skipped when REDIS_URL is unset — dev/test)
//
// Stays outside /api/v1 so the URL is stable across API versions —
// Railway's healthcheck and any uptime monitor can point here
// forever without re-configuring on a v2 bump.
//
// Returns 200 + { ok: true, checks: {...} } when healthy,
// 503 + { ok: false, checks: {...} } when anything failed. Never
// returns 500 — a 5xx from health is indistinguishable from an
// outage at the proxy layer.

interface CheckResult {
  ok: boolean
  latencyMs: number
  error?: string
}

async function timed(fn: () => Promise<void>): Promise<CheckResult> {
  const start = Date.now()
  try {
    await fn()
    return { ok: true, latencyMs: Date.now() - start }
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function checkDb(): Promise<CheckResult> {
  return timed(async () => {
    await prisma.$queryRaw`SELECT 1`
  })
}

async function checkRedis(): Promise<CheckResult> {
  // Skipped when Redis isn't configured — in dev/test the in-process
  // dispatcher runs, which isn't a dependency we can probe.
  if (!process.env.REDIS_URL) return { ok: true, latencyMs: 0 }
  return timed(async () => {
    const IORedis = (await import('ioredis')).default
    const r = new IORedis(process.env.REDIS_URL!, { lazyConnect: true, maxRetriesPerRequest: 1 })
    try {
      await r.connect()
      await r.ping()
    } finally {
      r.disconnect()
    }
  })
}

export async function GET() {
  const [db, redis] = await Promise.all([checkDb(), checkRedis()])
  const ok = db.ok && redis.ok
  if (!ok) log('error', 'health.check.failed', { db, redis })
  return NextResponse.json({ ok, checks: { db, redis } }, { status: ok ? 200 : 503 })
}
