import { NextResponse } from 'next/server'
import { handleMonoovaWebhook } from '@/lib/payments/monoova/webhook'

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

  try {
    await handleMonoovaWebhook(rawBody, signature)
    return NextResponse.json({ received: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Webhook processing failed'
    if (message === 'Invalid webhook signature') {
      return NextResponse.json({ error: message }, { status: 401 })
    }
    console.error('[webhooks/monoova]', error)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}
