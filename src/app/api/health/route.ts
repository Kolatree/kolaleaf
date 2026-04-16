import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'

// GET /api/health
//
// Lightweight liveness + readiness check used by Railway as the deploy
// healthcheck endpoint. Returns 200 only when the database accepts a
// trivial query — Railway promotes the new container to "active" only
// after this passes, so a broken DB connection never serves traffic.
//
// Public on purpose — no auth gate. Body is intentionally minimal so
// log/telemetry storage stays small at high check frequency.
export async function GET() {
  const startedAt = Date.now()

  try {
    await prisma.$queryRaw`SELECT 1`
    return NextResponse.json(
      {
        ok: true,
        db: 'up',
        latencyMs: Date.now() - startedAt,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[api/health] db check failed', err)
    return NextResponse.json(
      {
        ok: false,
        db: 'down',
        latencyMs: Date.now() - startedAt,
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
