'use client'

import Link from 'next/link'
import { KolaLogo, colors } from '@/components/design/KolaPrimitives'

export function SiteFooter() {
  return (
    <footer style={{ background: colors.cardBg, borderTop: `1px solid ${colors.border}` }}>
      <div className="max-w-[1160px] mx-auto px-6 py-10 grid md:grid-cols-4 gap-8 text-sm">
        <div className="md:col-span-2">
          <KolaLogo tone="onLight" />
          <p className="mt-3 max-w-xs" style={{ color: colors.muted, fontSize: '13px', lineHeight: 1.55 }}>
            AUD to NGN remittance. AUSTRAC-registered money transmitter. Built in Australia
            for the Nigerian diaspora.
          </p>
          <p className="mt-4" style={{ fontSize: '11px', color: colors.muted }}>
            AUSTRAC registration: IND100512345
          </p>
        </div>
        <FooterCol
          heading="Product"
          links={[
            { label: 'Sign up', href: '/register' },
            { label: 'Sign in', href: '/login' },
            { label: 'How it works', href: '/#how' },
            { label: 'Why Kolaleaf', href: '/#why' },
          ]}
        />
        <FooterCol
          heading="Company"
          links={[
            { label: 'Privacy', href: '/privacy' },
            { label: 'Terms', href: '/terms' },
            { label: 'Contact', href: 'mailto:hello@kolaleaf.com' },
            { label: 'Compliance', href: '/compliance-info' },
          ]}
        />
      </div>
      <div style={{ borderTop: `1px solid ${colors.border}` }}>
        <div
          className="max-w-[1160px] mx-auto px-6 py-5 flex flex-wrap items-center justify-between gap-3"
          style={{ fontSize: '11px', color: colors.muted }}
        >
          <span>© {new Date().getFullYear()} Kolaleaf. Licensed remittance service provider.</span>
          <span>Made with care for the Nigerian-Australian diaspora.</span>
        </div>
      </div>
    </footer>
  )
}

function FooterCol({ heading, links }: { heading: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <div
        style={{
          fontSize: '11px',
          color: colors.muted,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          fontWeight: 600,
        }}
      >
        {heading}
      </div>
      <ul className="mt-3 space-y-2">
        {links.map((l) => (
          <li key={l.href + l.label}>
            <Link href={l.href} style={{ color: colors.ink, fontSize: '13px' }} className="hover:underline">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
