import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { validateSession } from '@/lib/auth/sessions'
import { getSessionTokenFromCookie } from '@/lib/auth/middleware'
import { prisma } from '@/lib/db/client'
import AdminSidebar from './_components/admin-sidebar'

function getAdminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS ?? ''
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

export default async function AdminLayout({
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

  // Check admin email
  const emailIdentifier = await prisma.userIdentifier.findFirst({
    where: { userId: session.userId, type: 'EMAIL' },
    select: { identifier: true },
  })

  const adminEmails = getAdminEmails()
  if (!emailIdentifier || !adminEmails.includes(emailIdentifier.identifier.toLowerCase())) {
    redirect('/login')
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <AdminSidebar />
      <main className="flex-1 p-6">{children}</main>
    </div>
  )
}
