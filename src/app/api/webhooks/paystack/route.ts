import { NextResponse } from 'next/server'
import { handlePaystackWebhook } from '@/lib/payments/payout/webhooks'

export async function POST(request: Request) {
  const signature = request.headers.get('x-paystack-signature') ?? ''
  const secretKey = process.env.PAYSTACK_SECRET_KEY

  if (!secretKey) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  let rawBody: string
  let payload: unknown
  try {
    rawBody = await request.text()
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  try {
    await handlePaystackWebhook(payload, signature, secretKey)
    return NextResponse.json({ received: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Webhook processing failed'
    if (message === 'Invalid Paystack webhook signature') {
      return NextResponse.json({ error: message }, { status: 401 })
    }
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}
