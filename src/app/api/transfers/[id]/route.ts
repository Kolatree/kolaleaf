import { NextResponse } from 'next/server'
import { getTransfer } from '@/lib/transfers'
import { requireAuth, AuthError } from '@/lib/auth/middleware'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await requireAuth(request)
    const { id } = await params

    const transfer = await getTransfer(id, userId)
    if (!transfer) {
      return NextResponse.json({ error: 'Transfer not found' }, { status: 404 })
    }

    return NextResponse.json({ transfer })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    return NextResponse.json({ error: 'Failed to get transfer' }, { status: 500 })
  }
}
