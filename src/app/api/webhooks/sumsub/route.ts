import { NextResponse } from 'next/server'
import { verifySumsubSignature } from '@/lib/kyc/sumsub/verify-signature'
import { getWebhookDispatcher } from '@/lib/queue'
import { log } from '@/lib/obs/logger'

export async function POST(request: Request) {
  const signature = request.headers.get('x-payload-digest') ?? ''

  let rawBody: string
  try {
    rawBody = await request.text()
    JSON.parse(rawBody)
  } catch (err) {
    log('error', 'webhooks.sumsub.invalid-payload', { error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const secret = process.env.SUMSUB_WEBHOOK_SECRET
  if (!secret) {
    log('error', 'webhooks.sumsub.secret-not-configured', {})
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  if (!verifySumsubSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 })
  }

  try {
    await getWebhookDispatcher().dispatch({
      provider: 'sumsub',
      rawBody,
      signature,
      receivedAt: new Date().toISOString(),
    })
    return NextResponse.json({ received: true })
  } catch (error) {
    log('error', 'webhooks.sumsub.dispatch.failed', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}
