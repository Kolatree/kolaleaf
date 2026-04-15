'use client'

import Link from 'next/link'
import { KolaLogo, colors, GRADIENT } from '@/components/design/KolaPrimitives'

// Sticky translucent top nav for all public/marketing pages.
// On auth + dashboard routes, the app shell provides its own chrome instead.
export function SiteHeader() {
  return (
    <header
      className="sticky top-0 z-20"
      style={{
        background: 'rgba(255,255,255,0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: `1px solid ${colors.border}`,
      }}
    >
      <div className="max-w-[1160px] mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/" aria-label="Kolaleaf home" className="flex items-center gap-2">
          <KolaLogo tone="onLight" />
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-6 text-sm">
          <Link href="/#how" className="hidden md:inline hover:text-[#1a1a2e]" style={{ color: colors.muted }}>
            How it works
          </Link>
          <Link href="/#why" className="hidden md:inline hover:text-[#1a1a2e]" style={{ color: colors.muted }}>
            Why Kolaleaf
          </Link>
          <Link href="/login" style={{ color: colors.ink, fontWeight: 600 }}>
            Sign in
          </Link>
          <Link
            href="/register"
            className="text-white transition hover:brightness-110"
            style={{
              background: GRADIENT,
              padding: '8px 16px',
              borderRadius: '10px',
              fontSize: '13px',
              fontWeight: 600,
            }}
          >
            Start sending
          </Link>
        </nav>
      </div>
    </header>
  )
}
