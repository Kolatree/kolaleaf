'use client'

import Link from 'next/link'
import { useEffect, useId, useState } from 'react'
import { KolaLogo, colors, GRADIENT } from '@/components/design/KolaPrimitives'

// Sticky translucent top nav for all public/marketing pages.
// On auth + dashboard routes, the app shell provides its own chrome instead.
//
// Desktop (>= md): inline nav links + Sign in + Start sending.
// Mobile (< md):   hamburger toggles a dropdown with the same items.
export function SiteHeader() {
  const [open, setOpen] = useState(false)
  const menuId = useId()

  // Close on ESC.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

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
        <Link
          href="/"
          aria-label="Kolaleaf home"
          className="flex items-center gap-2"
          onClick={() => setOpen(false)}
        >
          <KolaLogo tone="onLight" />
        </Link>

        {/* Desktop nav */}
        <nav aria-label="Primary" className="hidden md:flex items-center gap-6 text-sm">
          <Link href="/#how" className="hover:text-[#1a1a2e]" style={{ color: colors.muted }}>
            How it works
          </Link>
          <Link href="/#why" className="hover:text-[#1a1a2e]" style={{ color: colors.muted }}>
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

        {/* Mobile hamburger toggle */}
        <button
          type="button"
          className="md:hidden inline-flex items-center justify-center"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((v) => !v)}
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '10px',
            border: `1px solid ${colors.border}`,
            background: colors.cardBg,
            color: colors.ink,
          }}
        >
          <HamburgerIcon open={open} />
        </button>
      </div>

      {/* Mobile menu panel + click-catcher. Rendered inline (not fixed)
          to avoid SSR/layout-shift issues. */}
      {open && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="md:hidden fixed inset-0 z-10"
            style={{ background: 'transparent', cursor: 'default' }}
          />
          <div
            id={menuId}
            className="md:hidden relative z-20"
            style={{
              background: colors.cardBg,
              borderTop: `1px solid ${colors.border}`,
              borderBottom: `1px solid ${colors.border}`,
            }}
          >
            <nav
              aria-label="Primary mobile"
              className="max-w-[1160px] mx-auto px-6 py-4 flex flex-col gap-1"
            >
              <MobileLink href="/#how" onClick={() => setOpen(false)}>
                How it works
              </MobileLink>
              <MobileLink href="/#why" onClick={() => setOpen(false)}>
                Why Kolaleaf
              </MobileLink>
              <MobileLink href="/login" onClick={() => setOpen(false)}>
                Sign in
              </MobileLink>
              <Link
                href="/register"
                onClick={() => setOpen(false)}
                className="text-white text-center transition hover:brightness-110"
                style={{
                  marginTop: '8px',
                  background: GRADIENT,
                  padding: '12px 16px',
                  borderRadius: '10px',
                  fontSize: '14px',
                  fontWeight: 600,
                }}
              >
                Start sending
              </Link>
            </nav>
          </div>
        </>
      )}
    </header>
  )
}

function MobileLink({
  href,
  onClick,
  children,
}: {
  href: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="block"
      style={{
        padding: '12px 4px',
        color: colors.ink,
        fontSize: '15px',
        fontWeight: 500,
        borderBottom: `1px solid ${colors.border}`,
      }}
    >
      {children}
    </Link>
  )
}

function HamburgerIcon({ open }: { open: boolean }) {
  // Inline SVG — avoids pulling in an icon dep for a single glyph.
  return open ? (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M4 4l12 12M16 4L4 16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  ) : (
    <svg width="18" height="14" viewBox="0 0 20 14" aria-hidden="true">
      <path
        d="M2 2h16M2 7h16M2 12h16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}
