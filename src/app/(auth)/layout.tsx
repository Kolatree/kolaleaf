import { SiteHeader } from '../_components/site-header'
import { SiteFooter } from '../_components/site-footer'
import { GRADIENT, colors } from '@/components/design/KolaPrimitives'

// Auth pages wear the same public chrome as the marketing group — sticky
// SiteHeader on top, SiteFooter at the bottom — with a contained gradient
// band in the middle holding the sign-in / sign-up card. Matches Variant D.
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col" style={{ background: colors.pageBg }}>
      <SiteHeader />
      <main
        className="flex-1 flex items-center justify-center px-4 py-14 md:py-20"
        style={{ background: GRADIENT }}
      >
        {children}
      </main>
      <SiteFooter />
    </div>
  )
}
