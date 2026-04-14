import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { validateSession } from '@/lib/auth/sessions'
import { getSessionTokenFromCookie } from '@/lib/auth/middleware'
import BottomNav from './_components/bottom-nav'

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

  return (
    <div className="min-h-screen bg-gradient-to-br from-kolaleaf-purple to-kolaleaf-green">
      <div className="pb-24">
        {children}
      </div>
      <BottomNav />
    </div>
  )
}
