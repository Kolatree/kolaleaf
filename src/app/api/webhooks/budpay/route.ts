import { NextResponse } from 'next/server'
import { verifyBudPaySignature } from '@/lib/payments/payout/verify-signature'
import { getWebhookDispatcher } from '@/lib/queue'

// BudPay payout webhook receiver.
//
// Signature: HMAC-SHA512 over the raw HTTP body, keyed on
// BUDPAY_WEBHOOK_SECRET. Verified at the edge so forgeries can't flood
// the dispatcher queue.
//
// Header name: BudPay documents the signature under different names
// across their docs pages (`merchant_signature`, `merchant-signature`,
// `x-budpay-signature`). We accept any of them to be resilient to
// vendor-side header casing or naming drift — whichever arrives first
// wins.
export async function POST(request: Request) {
  const signature =
    request.headers.get('merchant_signature') ??
    request.headers.get('merchant-signature') ??
    request.headers.get('x-budpay-signature') ??
    ''
  const webhookSecret = process.env.BUDPAY_WEBHOOK_SECRET

  if (!webhookSecret) {
    console.error('[webhooks/budpay] BUDPAY_WEBHOOK_SECRET not configured')
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  let rawBody: string
  try {
    rawBody = await request.text()
    JSON.parse(rawBody)
  } catch (err) {
    console.error('[webhooks/budpay] invalid payload', err)
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  if (!verifyBudPaySignature(rawBody, signature, webhookSecret)) {
    return NextResponse.json(
      { error: 'Invalid BudPay webhook signature' },
      { status: 401 },
    )
  }

  try {
    await getWebhookDispatcher().dispatch({
      provider: 'budpay',
      rawBody,
      signature,
      receivedAt: new Date().toISOString(),
    })
    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('[webhooks/budpay] dispatch failed', error)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}
