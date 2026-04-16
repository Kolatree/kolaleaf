import { NextResponse } from 'next/server'
import { verifyPaystackSignature } from '@/lib/payments/payout/verify-signature'
import { getWebhookDispatcher } from '@/lib/queue'

export async function POST(request: Request) {
  const signature = request.headers.get('x-paystack-signature') ?? ''
  const secretKey = process.env.PAYSTACK_SECRET_KEY

  if (!secretKey) {
    console.error('[webhooks/paystack] PAYSTACK_SECRET_KEY not configured')
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  let rawBody: string
  try {
    rawBody = await request.text()
    JSON.parse(rawBody)
  } catch (err) {
    console.error('[webhooks/paystack] invalid payload', err)
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  if (!verifyPaystackSignature(rawBody, signature, secretKey)) {
    return NextResponse.json(
      { error: 'Invalid Paystack webhook signature' },
      { status: 401 },
    )
  }

  try {
    await getWebhookDispatcher().dispatch({
      provider: 'paystack',
      rawBody,
      signature,
      receivedAt: new Date().toISOString(),
    })
    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('[webhooks/paystack] dispatch failed', error)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}
