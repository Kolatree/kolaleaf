import { NextResponse } from 'next/server'
import { cancelTransfer } from '@/lib/transfers'
import { requireAuth, AuthError } from '@/lib/auth/middleware'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await requireAuth(request)
    const { id } = await params

    const transfer = await cancelTransfer({ transferId: id, userId })
    return NextResponse.json({ transfer })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    const message = error instanceof Error ? error.message : 'Cancel failed'
    const name = error instanceof Error ? error.name : ''

    if (name === 'TransferNotFoundError') return NextResponse.json({ error: message }, { status: 404 })
    if (name === 'NotTransferOwnerError') return NextResponse.json({ error: message }, { status: 403 })
    if (name === 'CancelTooLateError') return NextResponse.json({ error: message }, { status: 409 })
    if (name === 'InvalidTransitionError') return NextResponse.json({ error: message }, { status: 409 })

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
