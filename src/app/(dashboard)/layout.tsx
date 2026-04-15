import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { validateSession } from '@/lib/auth/sessions'
import { getSessionTokenFromCookie } from '@/lib/auth/middleware'

// The (dashboard) group layout is auth-only — the visual shell lives in
// DashboardShell (applied by each page). This keeps auth server-side and the
// shell client-side, while letting the Send page render its gradient hero.
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const cookieStore = await cookies()
  const token = getSessionTokenFromCookie(
    cookieStore.getAll().map((c) => `${c.name}=${c.value}`).join('; '),
  )

  if (!token) {
    redirect('/login')
  }

  const session = await validateSession(token)
  if (!session) {
    redirect('/login')
  }

  return <>{children}</>
}
