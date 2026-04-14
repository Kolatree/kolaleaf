import { NextResponse } from 'next/server'
import { verifyTotpToken } from '@/lib/auth'
import { requireAuth } from '@/lib/auth/middleware'
import { AuthError } from '@/lib/auth/middleware'
import { prisma } from '@/lib/db/client'

export async function POST(request: Request) {
  let body: { token?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { token } = body
  if (!token || typeof token !== 'string' || token.length !== 6) {
    return NextResponse.json({ error: 'A 6-digit code is required' }, { status: 400 })
  }

  try {
    const { userId } = await requireAuth(request)
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })

    if (!user.totpSecret || !user.totpEnabled) {
      return NextResponse.json({ error: '2FA is not enabled' }, { status: 400 })
    }

    const valid = verifyTotpToken(user.totpSecret, token)
    if (!valid) {
      return NextResponse.json({ error: 'Invalid 2FA code' }, { status: 401 })
    }

    return NextResponse.json({ verified: true })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 })
  }
}
