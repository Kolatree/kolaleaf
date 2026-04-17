import { NextResponse } from 'next/server'
import { revokeSession } from '@/lib/auth'
import { requireAuth, clearSessionCookie } from '@/lib/auth/middleware'
import type { AuthError } from '@/lib/auth/middleware'

export async function POST(request: Request) {
  try {
    const { session } = await requireAuth(request)
    await revokeSession(session.id)

    const response = NextResponse.json({ success: true })
    response.headers.set('Set-Cookie', clearSessionCookie())
    return response
  } catch (error) {
    if ((error as AuthError).statusCode === 401) {
      // Already logged out, clear cookie anyway
      const response = NextResponse.json({ success: true })
      response.headers.set('Set-Cookie', clearSessionCookie())
      return response
    }
    return NextResponse.json({ error: 'Logout failed' }, { status: 500 })
  }
}
