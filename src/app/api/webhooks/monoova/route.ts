import { NextResponse } from 'next/server'
import { handleMonoovaWebhook } from '@/lib/payments/monoova/webhook'

export async function POST(request: Request) {
  const signature = request.headers.get('x-monoova-signature') ?? ''

  let rawBody: string
  let payload: unknown
  try {
    rawBody = await request.text()
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  try {
    await handleMonoovaWebhook(payload, signature)
    return NextResponse.json({ received: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Webhook processing failed'
    if (message === 'Invalid webhook signature') {
      return NextResponse.json({ error: message }, { status: 401 })
    }
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}
