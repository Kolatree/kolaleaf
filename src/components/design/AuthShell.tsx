import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  KolaLogo,
  Tagline,
  colors,
  radius,
  shadow,
  spacing,
} from './KolaPrimitives'

// Shared chrome for the auth / onboarding pages (register, verify,
// details, kyc, verify-email-legacy). Centralises:
//   - the purple→green gradient shell
//   - the Kola logo + tagline header
//   - the white content card with the standard radius + shadow
//   - the trust-indicators row at the bottom (AUSTRAC / speed / rating)
//
// Each page passes its own content via `children`. Width defaults to
// `max-w-sm` for the wizard steps; the details step overrides to
// `md` because of its longer form.
export interface AuthShellProps {
  children: ReactNode
  /** Max width of the card. 'sm' for short forms, 'md' for the
   *  details step with its longer address block. */
  width?: 'sm' | 'md'
  /** Copy under the logo in the header. Defaults to the standard
   *  Kolaleaf tagline; pages can override for step-specific context. */
  subtitle?: ReactNode
  /** When true, renders a full-page gradient background (for dashboard-
   *  scoped auth pages like /kyc). When false (default), the surrounding
   *  layout is expected to paint the gradient — the (auth) route group
   *  already wraps its children in the gradient shell. */
  fullScreen?: boolean
}

const widthClass = {
  sm: 'w-full max-w-sm',
  md: 'w-full max-w-md',
} as const

function TrustIndicators() {
  return (
    <div className="mt-6 flex items-center justify-center gap-5 text-white/80" style={{ fontSize: '11px' }}>
      <span>🔒 AUSTRAC</span>
      <span>⚡ Minutes</span>
      <span>★ 4.8/5</span>
    </div>
  )
}

function Card({ children, width }: { children: ReactNode; width: 'sm' | 'md' }) {
  return (
    <div className={`${widthClass[width]} kola-card-enter`}>
      <div className="text-center mb-8">
        <KolaLogo tone="onDark" size="lg" />
        <div className="mt-2"><Tagline tone="onDark" /></div>
      </div>
      <div
        style={{
          background: colors.cardBg,
          borderRadius: radius.card,
          padding: spacing.cardPad,
          boxShadow: shadow.card,
          color: colors.ink,
        }}
      >
        {children}
      </div>
      <TrustIndicators />
    </div>
  )
}

export function AuthShell({ children, width = 'sm', fullScreen = false }: AuthShellProps) {
  if (!fullScreen) {
    return <Card width={width}>{children}</Card>
  }
  // Full-screen variant for pages that live outside the /(auth) route
  // group (notably /kyc, which is under /(dashboard)).
  return (
    <div className="flex min-h-screen flex-col" style={{ background: colors.pageBg }}>
      <main
        className="flex-1 flex items-center justify-center px-4 py-14 md:py-20"
        style={{
          background: 'linear-gradient(135deg, #6d4aff 0%, #1aa85a 100%)',
        }}
      >
        <Card width={width}>{children}</Card>
      </main>
    </div>
  )
}

// Re-export common sub-elements so callers importing AuthShell can also
// grab the standardised footer link / helper text without a second import.
export function AuthFooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <p className="text-center mt-5" style={{ fontSize: '13px', color: colors.muted }}>
      {children}{' '}
      <Link href={href} style={{ color: colors.purple, fontWeight: 600 }}>
        Sign in
      </Link>
    </p>
  )
}
