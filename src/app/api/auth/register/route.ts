import { NextResponse } from 'next/server'
import { registerUser } from '@/lib/auth'
import { setSessionCookie } from '@/lib/auth/middleware'

export async function POST(request: Request) {
  let body: { fullName?: string; email?: string; password?: string; referralCode?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { fullName, email, password, referralCode } = body

  if (!fullName || typeof fullName !== 'string' || fullName.trim().length === 0) {
    return NextResponse.json({ error: 'Full name is required' }, { status: 400 })
  }
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 })
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }

  try {
    const { user, session } = await registerUser({
      fullName: fullName.trim(),
      email: email.trim().toLowerCase(),
      password,
      referralCode: referralCode || undefined,
    })

    const response = NextResponse.json(
      { user: { id: user.id, fullName: user.fullName, email: email.trim().toLowerCase() } },
      { status: 201 },
    )
    response.headers.set('Set-Cookie', setSessionCookie(session.token))
    return response
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Registration failed'
    if (message === 'Email already registered') {
      return NextResponse.json({ error: message }, { status: 409 })
    }
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
