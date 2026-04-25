import { NextResponse } from 'next/server'
import { cancelTransfer } from '@/lib/transfers'
import { requireAuth, AuthError } from '@/lib/auth/middleware'
import {
  TransferNotFoundError,
  NotTransferOwnerError,
  CancelTooLateError,
  InvalidTransitionError,
} from '@/lib/transfers/errors'

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
    if (error instanceof TransferNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 })
    if (error instanceof NotTransferOwnerError) return NextResponse.json({ error: error.message }, { status: 403 })
    if (error instanceof CancelTooLateError) return NextResponse.json({ error: error.message }, { status: 409 })
    if (error instanceof InvalidTransitionError) return NextResponse.json({ error: error.message }, { status: 409 })

    const message = error instanceof Error ? error.message : 'Cancel failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
