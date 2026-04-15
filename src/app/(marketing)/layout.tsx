import { SiteHeader } from '../_components/site-header'
import { SiteFooter } from '../_components/site-footer'
import { colors } from '@/components/design/KolaPrimitives'

// Shared chrome for every public/marketing page.
// Any new file inside src/app/(marketing)/ automatically gets the persistent
// top nav and footer.
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col" style={{ background: colors.pageBg }}>
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  )
}
