import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { validateSession } from '@/lib/auth/sessions'
import { getSessionTokenFromCookie } from '@/lib/auth/middleware'
import { LandingPage } from '../_components/landing-page'

// Public root: logged-in users go straight to /send.
// Everyone else sees the marketing landing page (wrapped by (marketing)/layout.tsx).
export default async function Home() {
  const cookieStore = await cookies()
  const token = getSessionTokenFromCookie(
    cookieStore.getAll().map((c) => `${c.name}=${c.value}`).join('; '),
  )

  if (token) {
    const session = await validateSession(token)
    if (session) {
      redirect('/send')
    }
  }

  return <LandingPage />
}
