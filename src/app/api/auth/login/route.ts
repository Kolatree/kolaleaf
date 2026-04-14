import { NextResponse } from 'next/server'
import { loginUser } from '@/lib/auth'
import { setSessionCookie } from '@/lib/auth/middleware'

export async function POST(request: Request) {
  let body: { identifier?: string; password?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { identifier, password } = body

  if (!identifier || typeof identifier !== 'string') {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 })
  }
  if (!password || typeof password !== 'string') {
    return NextResponse.json({ error: 'Password is required' }, { status: 400 })
  }

  const ip = request.headers.get('x-forwarded-for') ?? undefined
  const userAgent = request.headers.get('user-agent') ?? undefined

  try {
    const { user, session, requires2FA } = await loginUser({
      identifier: identifier.trim().toLowerCase(),
      password,
      ip,
      userAgent,
    })

    const response = NextResponse.json({
      user: { id: user.id, fullName: user.fullName },
      requires2FA,
    })
    response.headers.set('Set-Cookie', setSessionCookie(session.token))
    return response
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Login failed'
    return NextResponse.json({ error: message }, { status: 401 })
  }
}
