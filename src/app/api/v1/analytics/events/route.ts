import { NextResponse } from 'next/server'
import { AuthError, requireAuth } from '@/lib/auth/middleware'
import { jsonError } from '@/lib/http/json-error'
import { parseBody } from '@/lib/http/validate'
import { log } from '@/lib/obs/logger'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { AnalyticsEventBody } from './_schemas'

export async function POST(request: Request) {
  try {
    const { userId } = await requireAuth(request)
    const parsed = await parseBody(request, AnalyticsEventBody)
    if (!parsed.ok) return parsed.response

    await recordAnalyticsEvent(userId, parsed.data)

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof AuthError) {
      const reason = error.statusCode === 401 ? 'unauthenticated' : 'forbidden'
      return jsonError(reason, error.message, error.statusCode)
    }
    log('error', 'analytics.events.failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return jsonError('analytics_event_failed', 'Could not record analytics event', 500)
  }
}
