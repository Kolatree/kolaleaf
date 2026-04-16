import { NextResponse } from 'next/server'
import { verifyFlutterwaveSignature } from '@/lib/payments/payout/verify-signature'
import { getWebhookDispatcher } from '@/lib/queue'

export async function POST(request: Request) {
  const signature = request.headers.get('verif-hash') ?? ''
  const webhookSecret = process.env.FLUTTERWAVE_WEBHOOK_SECRET

  if (!webhookSecret) {
    console.error('[webhooks/flutterwave] FLUTTERWAVE_WEBHOOK_SECRET not configured')
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  let rawBody: string
  try {
    rawBody = await request.text()
    JSON.parse(rawBody)
  } catch (err) {
    console.error('[webhooks/flutterwave] invalid payload', err)
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  if (!verifyFlutterwaveSignature(signature, webhookSecret)) {
    return NextResponse.json(
      { error: 'Invalid Flutterwave webhook signature' },
      { status: 401 },
    )
  }

  try {
    await getWebhookDispatcher().dispatch({
      provider: 'flutterwave',
      rawBody,
      signature,
      receivedAt: new Date().toISOString(),
    })
    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('[webhooks/flutterwave] dispatch failed', error)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}
