import { NextResponse } from 'next/server'
import { verifyMonoovaSignature } from '@/lib/payments/monoova/verify-signature'
import { getWebhookDispatcher } from '@/lib/queue'

export async function POST(request: Request) {
  const signature = request.headers.get('x-monoova-signature') ?? ''

  let rawBody: string
  try {
    rawBody = await request.text()
    JSON.parse(rawBody)
  } catch (err) {
    console.error('[webhooks/monoova] invalid payload', err)
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const secret = process.env.MONOOVA_WEBHOOK_SECRET
  if (!secret) {
    console.error('[webhooks/monoova] MONOOVA_WEBHOOK_SECRET not configured')
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  // Verify signature BEFORE enqueue. Rejects junk payloads at the edge so
  // attackers can't flood the queue with forgeries.
  if (!verifyMonoovaSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 })
  }

  try {
    await getWebhookDispatcher().dispatch({
      provider: 'monoova',
      rawBody,
      signature,
      receivedAt: new Date().toISOString(),
    })
    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('[webhooks/monoova] dispatch failed', error)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}
