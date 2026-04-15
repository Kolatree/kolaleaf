'use client';

// Kolaleaf design primitives. Faithful to the approved mobile sketch.
// Every value is sourced from src/lib/design/tokens.ts. No ad-hoc colors, radii, or sizes.
//
// Source sketch: ~/.gstack/projects/Kolaleaf/designs/send-screen-20260414/approved-wireframe.html
// Winning variant: D — "Floating Card on Light" (see DESIGN_PLAN.md)

import { colors, gradient, radius, type, spacing, shadow, flag } from '@/lib/design/tokens';

// Re-export token surfaces commonly needed alongside primitives
export { gradient as GRADIENT, colors, radius, shadow, spacing, type };

export function KolaLogo({ size = 'md', tone = 'onDark' }: { size?: 'sm' | 'md' | 'lg'; tone?: 'onDark' | 'onLight' }) {
  const sz = size === 'sm' ? '18px' : size === 'lg' ? '30px' : type.logo.size;
  const baseColor = tone === 'onDark' ? '#ffffff' : colors.ink;
  return (
    <div
      className="leading-none"
      style={{ fontSize: sz, fontWeight: type.logo.weight, letterSpacing: type.logo.letterSpacing, color: baseColor }}
    >
      Kola<span style={{ color: colors.greenLight }}>leaf</span>
    </div>
  );
}

export function Tagline({ tone = 'onDark' }: { tone?: 'onDark' | 'onLight' }) {
  return (
    <div
      style={{
        fontSize: type.tagline.size,
        opacity: tone === 'onDark' ? type.tagline.opacity : 1,
        color: tone === 'onDark' ? '#fff' : colors.muted,
        fontWeight: type.tagline.weight,
      }}
    >
      Fast. Secure. Better rates to Nigeria.
    </div>
  );
}

export function FlagAU() {
  return <span aria-hidden className="inline-block" style={{ ...flag.size, borderRadius: radius.flag, background: flag.au }} />;
}
export function FlagNG() {
  return <span aria-hidden className="inline-block" style={{ ...flag.size, borderRadius: radius.flag, background: flag.ng }} />;
}

export function CurrencyBadge({ code }: { code: 'AUD' | 'NGN' }) {
  return (
    <span
      className="inline-flex items-center gap-1.5"
      style={{
        background: colors.chipBg,
        padding: spacing.chipPad,
        borderRadius: radius.chip,
        fontSize: type.currencyCode.size,
        fontWeight: type.currencyCode.weight,
        color: colors.ink,
      }}
    >
      {code === 'AUD' ? <FlagAU /> : <FlagNG />}
      {code}
    </span>
  );
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: type.fieldLabel.size,
        color: colors.muted,
        textTransform: 'uppercase',
        letterSpacing: type.fieldLabel.letterSpacing,
        fontWeight: type.fieldLabel.weight,
      }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TransferCard — presentation-only, pixel-faithful to the mobile sketch.
// Implementer wires to the rate + recipient + submit APIs via props.
// ---------------------------------------------------------------------------

export interface TransferCardProps {
  amountAud: number;
  onAmountChange?: (value: number) => void;
  rateCustomer: number;                // e.g. 1042.50
  receiveMethod?: string;              // default "Bank Transfer"
  feeAud?: number;                     // default 0
  onSubmit?: () => void;
  submitting?: boolean;
  error?: string;
  maxW?: string;                       // default "420px"
}

export function TransferCard({
  amountAud,
  onAmountChange,
  rateCustomer,
  receiveMethod = 'Bank Transfer',
  feeAud = 0,
  onSubmit,
  submitting = false,
  error,
  maxW = '420px',
}: TransferCardProps) {
  const ngn = amountAud * rateCustomer;

  return (
    <div
      className="w-full flex flex-col"
      style={{
        maxWidth: maxW,
        background: colors.cardBg,
        borderRadius: radius.card,
        padding: spacing.cardPad,
        boxShadow: shadow.card,
        color: colors.ink,
        gap: '16px',
      }}
    >
      {/* You send */}
      <div>
        <FieldLabel>You send</FieldLabel>
        <div className="mt-2.5 flex items-center justify-between">
          <input
            inputMode="decimal"
            aria-label="Amount in AUD"
            value={amountAud.toLocaleString('en-AU')}
            onChange={(e) => onAmountChange?.(Number(e.target.value.replace(/[^0-9.]/g, '')) || 0)}
            className="tabular-nums bg-transparent border-0 outline-none w-[60%]"
            style={{ fontSize: type.amount.size, fontWeight: type.amount.weight, color: colors.ink, lineHeight: 1 }}
          />
          <CurrencyBadge code="AUD" />
        </div>
      </div>

      {/* Best Rate pill */}
      <output
        className="text-center block"
        style={{
          background: colors.bgSoft,
          borderRadius: radius.rateBar,
          padding: spacing.rateBarPad,
          fontSize: type.rateBar.size,
          fontWeight: type.rateBar.weight,
          color: colors.green,
        }}
      >
        <span style={{ color: colors.muted, fontWeight: 400 }}>Best Rate</span>
        <span style={{ margin: '0 8px' }}>·</span>
        1 AUD = {rateCustomer.toFixed(2)} NGN
      </output>

      {/* They receive */}
      <div>
        <FieldLabel>They receive</FieldLabel>
        <div className="mt-2.5 flex items-center justify-between">
          <div
            className="tabular-nums"
            style={{ fontSize: type.amount.size, fontWeight: type.amount.weight, color: colors.green, lineHeight: 1 }}
          >
            {Math.floor(ngn).toLocaleString('en-NG')}
          </div>
          <CurrencyBadge code="NGN" />
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: '1px', background: colors.border, margin: '4px 0' }} />

      {/* Detail rows */}
      <dl className="flex flex-col" style={{ gap: spacing.rowGap }}>
        <Row label="Receive method" value={receiveMethod} />
        <Row label="Fee"             value={`${feeAud} AUD`}                  tone="green" />
        <Row label="Transfer time"   value="Minutes"                          tone="green" />
        <Row label="Total to pay"    value={`${amountAud.toLocaleString('en-AU')} AUD`} tone="highlight" />
      </dl>

      {error && (
        <div role="alert" style={{ fontSize: '13px', color: '#b00020' }}>{error}</div>
      )}

      {/* CTA */}
      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting}
        aria-busy={submitting}
        className="w-full text-white transition hover:brightness-110 disabled:opacity-60 disabled:cursor-not-allowed"
        style={{
          background: gradient,
          padding: spacing.ctaPad,
          borderRadius: radius.cta,
          fontSize: type.cta.size,
          fontWeight: type.cta.weight,
          letterSpacing: type.cta.letterSpacing,
          marginTop: '16px',
        }}
      >
        {submitting ? 'Sending…' : 'Send Money'}
      </button>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'highlight' }) {
  const valueStyle: React.CSSProperties =
    tone === 'green'
      ? { color: colors.green, fontWeight: type.rowValue.weight }
      : tone === 'highlight'
      ? { color: colors.purple, fontWeight: type.rowTotal.weight }
      : { color: colors.ink, fontWeight: type.rowValue.weight };
  return (
    <div className="flex justify-between" style={{ fontSize: type.rowLabel.size }}>
      <dt style={{ color: colors.muted }}>{label}</dt>
      <dd style={valueStyle}>{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TrustBar — white background, muted text, emoji glyphs standing in for gold icons.
// ---------------------------------------------------------------------------

export function TrustBar({
  rating = 4.8,
}: { rating?: number } = {}) {
  const items = [
    { icon: '🔒', label: 'AUSTRAC', sub: 'Registered' },
    { icon: '⚡', label: 'Minutes', sub: 'Delivery' },
    { icon: '★',  label: `${rating}/5`, sub: 'Trust Score' },
  ];
  return (
    <div
      className="flex items-center justify-between"
      style={{ padding: spacing.trustBarPad, fontSize: type.trustSub.size, color: colors.muted, background: colors.cardBg, borderTop: `1px solid ${colors.border}` }}
    >
      {items.map((it) => (
        <div key={it.label} className="text-center">
          <div style={{ fontSize: type.trustIcon.size, marginBottom: '2px', lineHeight: 1 }}>{it.icon}</div>
          <div style={{ color: colors.ink, fontWeight: type.trustLabel.weight, fontSize: type.trustLabel.size }}>{it.label}</div>
          <div>{it.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Navigation — bottom (mobile) + sidebar (desktop)
// ---------------------------------------------------------------------------

export type NavKey = 'Send' | 'Activity' | 'Recipients' | 'Account';

const NAV_ITEMS: { icon: string; label: NavKey; href: string }[] = [
  { icon: '↗', label: 'Send',       href: '/send' },
  { icon: '↙', label: 'Activity',   href: '/activity' },
  { icon: '👤', label: 'Recipients', href: '/recipients' },
  { icon: '⚙', label: 'Account',    href: '/account' },
];

export function BottomNav({ active = 'Send' }: { active?: NavKey }) {
  return (
    <nav
      aria-label="Primary mobile"
      className="flex justify-around"
      style={{ background: colors.cardBg, borderTop: `1px solid ${colors.border}`, padding: spacing.bottomNavPad }}
    >
      {NAV_ITEMS.map((it) => {
        const isActive = it.label === active;
        return (
          <a
            key={it.label}
            href={it.href}
            className="text-center"
            style={{ fontSize: type.navLabel.size, color: isActive ? colors.purple : colors.muted }}
          >
            <div style={{ fontSize: type.navIcon.size, marginBottom: '2px', lineHeight: 1 }}>{it.icon}</div>
            {it.label}
          </a>
        );
      })}
    </nav>
  );
}

export function SidebarNav({ active = 'Send' }: { active?: NavKey }) {
  return (
    <aside
      className="h-full flex flex-col"
      style={{ width: '220px', background: colors.cardBg, borderRight: `1px solid ${colors.border}`, color: colors.ink }}
    >
      <div className="p-6">
        <KolaLogo tone="onLight" />
        <div style={{ fontSize: type.tagline.size, color: colors.muted, marginTop: '2px' }}>Fast. Secure.</div>
      </div>
      <nav aria-label="Primary" className="flex flex-col gap-1 px-3">
        {NAV_ITEMS.map((it) => {
          const isActive = it.label === active;
          return (
            <a
              key={it.label}
              href={it.href}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
              style={{
                fontSize: '14px',
                fontWeight: 500,
                background: isActive ? colors.bgSoft : 'transparent',
                color: isActive ? colors.green : colors.muted,
              }}
            >
              <span style={{ fontSize: '16px', lineHeight: 1 }}>{it.icon}</span>
              {it.label}
            </a>
          );
        })}
      </nav>
      <div className="mt-auto p-5" style={{ borderTop: `1px solid ${colors.border}`, fontSize: '11px', color: colors.muted }}>
        <div>🔒 AUSTRAC Registered</div>
        <div className="mt-1">⚡ Delivered in minutes</div>
        <div className="mt-1">★ 4.8/5 · 1,247 reviews</div>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Admin shell — same visual language as DashboardShell but different nav items
// and no gradient hero (data-dense pages).
// ---------------------------------------------------------------------------

export type AdminNavKey = 'Dashboard' | 'Transfers' | 'Rates' | 'Compliance';

const ADMIN_NAV_ITEMS: { icon: string; label: AdminNavKey; href: string }[] = [
  { icon: '◆', label: 'Dashboard',  href: '/admin' },
  { icon: '↙', label: 'Transfers',  href: '/admin/transfers' },
  { icon: '%', label: 'Rates',      href: '/admin/rates' },
  { icon: '⚑', label: 'Compliance', href: '/admin/compliance' },
];

export function AdminSidebar({ active }: { active: AdminNavKey }) {
  return (
    <aside
      className="h-full flex flex-col shrink-0"
      style={{ width: '220px', background: colors.cardBg, borderRight: `1px solid ${colors.border}`, color: colors.ink }}
    >
      <div className="p-6">
        <KolaLogo tone="onLight" />
        <div style={{ fontSize: type.tagline.size, color: colors.muted, marginTop: '2px' }}>Admin console</div>
      </div>
      <nav aria-label="Admin" className="flex flex-col gap-1 px-3">
        {ADMIN_NAV_ITEMS.map((it) => {
          const isActive = it.label === active;
          return (
            <a
              key={it.label}
              href={it.href}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
              style={{
                fontSize: '14px',
                fontWeight: 500,
                background: isActive ? colors.bgSoft : 'transparent',
                color: isActive ? colors.green : colors.muted,
              }}
            >
              <span style={{ fontSize: '16px', lineHeight: 1 }}>{it.icon}</span>
              {it.label}
            </a>
          );
        })}
      </nav>
      <div className="mt-auto p-5" style={{ borderTop: `1px solid ${colors.border}`, fontSize: '11px', color: colors.muted }}>
        <a href="/send" style={{ color: colors.purple }}>← Exit admin</a>
      </div>
    </aside>
  );
}

export function AdminShell({ active, children }: { active: AdminNavKey; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen" style={{ background: colors.pageBg }}>
      <div className="hidden md:block">
        <AdminSidebar active={active} />
      </div>
      <main className="flex-1 p-6 md:p-10 kola-page-enter">
        <div className="max-w-[1200px] mx-auto">{children}</div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DashboardShell — the Variant D app frame. Use on every dashboard page.
// Pass `hero` (ReactNode) for the Send page's gradient frame; omit on
// Activity/Recipients/Account for a light-only layout.
// ---------------------------------------------------------------------------

export interface DashboardShellProps {
  active: NavKey;
  hero?: React.ReactNode;
  children?: React.ReactNode;
}

export function DashboardShell({ active, hero, children }: DashboardShellProps) {
  return (
    <div
      className="grid md:grid-cols-[220px_1fr] min-h-screen"
      style={{ background: colors.pageBg }}
    >
      <div className="hidden md:block">
        <SidebarNav active={active} />
      </div>
      <main className="flex flex-col kola-page-enter">
        {hero && (
          <section className="flex-1 grid md:grid-cols-2 gap-8 p-6 md:p-12 items-center">
            {hero}
          </section>
        )}
        {!hero && children && <section className="flex-1 p-6 md:p-10">{children}</section>}
        {hero && children && <section className="px-6 md:px-12 pb-10">{children}</section>}

        <div className="hidden md:block"><TrustBar /></div>
        <div className="md:hidden">
          <TrustBar />
          <BottomNav active={active} />
        </div>
      </main>
    </div>
  );
}

// Inline alert banner for admin surfaces. Uses Variant D tokens. Minimal
// API on purpose — admin pages render at most one or two of these per page.
export function AdminAlert({
  tone = 'warn',
  children,
}: {
  tone?: 'warn' | 'error';
  children: React.ReactNode;
}) {
  const palette =
    tone === 'error'
      ? { bg: 'rgba(176,0,32,0.08)', border: 'rgba(176,0,32,0.35)', text: '#b00020' }
      : { bg: 'rgba(255,215,0,0.12)', border: 'rgba(255,215,0,0.45)', text: '#8a6d0a' };
  return (
    <div
      role="alert"
      data-testid="admin-alert"
      className="mb-6"
      style={{
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        borderRadius: radius.card,
        padding: spacing.cardPad,
        color: palette.text,
        fontSize: '13px',
        fontWeight: 600,
      }}
    >
      {children}
    </div>
  );
}
