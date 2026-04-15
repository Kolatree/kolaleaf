import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { validateSession } from '@/lib/auth/sessions'
import { getSessionTokenFromCookie } from '@/lib/auth/middleware'
import { prisma } from '@/lib/db/client'

function getAdminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS ?? ''
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

// Admin group layout — auth + admin-email gate only. The visual shell
// (AdminShell) is applied by each page so pages can declare their own active
// nav item and render into a consistent frame.
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

  const emailIdentifier = await prisma.userIdentifier.findFirst({
    where: { userId: session.userId, type: 'EMAIL' },
    select: { identifier: true },
  })

  const adminEmails = getAdminEmails()
  if (!emailIdentifier || !adminEmails.includes(emailIdentifier.identifier.toLowerCase())) {
    redirect('/login')
  }

  return <>{children}</>
}
