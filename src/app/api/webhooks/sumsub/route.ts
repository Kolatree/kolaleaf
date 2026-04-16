import { NextResponse } from 'next/server'
import { verifySumsubSignature } from '@/lib/kyc/sumsub/verify-signature'
import { getWebhookDispatcher } from '@/lib/queue'

export async function POST(request: Request) {
  const signature = request.headers.get('x-payload-digest') ?? ''

  let rawBody: string
  try {
    rawBody = await request.text()
    JSON.parse(rawBody)
  } catch (err) {
    console.error('[webhooks/sumsub] invalid payload', err)
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const secret = process.env.SUMSUB_WEBHOOK_SECRET
  if (!secret) {
    console.error('[webhooks/sumsub] SUMSUB_WEBHOOK_SECRET not configured')
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
    console.error('[webhooks/sumsub] dispatch failed', error)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}
