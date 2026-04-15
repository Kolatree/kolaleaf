# Kolaleaf Web App — Design Implementation Plan

**Winning variant:** **D — "Floating Card on Light"**
**Date:** 2026-04-15
**Source of truth:** Approved mobile sketch at `~/.gstack/projects/Kolaleaf/designs/send-screen-20260414/approved-wireframe.html` (also mirrored at `file:///tmp/gstack-kolaleaf-sketch.html`)

---

## Summary

Variant D wins because it:

1. Preserves the approved mobile transfer card **pixel-for-pixel** (logo, gradient, Best Rate pill, amount inputs, summary rows, Send Money CTA)
2. Keeps the page **light** (`#f5f5f5`) — no dark backgrounds anywhere
3. Uses the purple→green gradient as a **contained "frame"** around the transfer card, giving it product-photo presence on desktop without gradient fatigue on data-heavy pages (Activity, Admin)
4. Separates the emotional pitch (headline + chips, left column) from the action (card, right column) on desktop
5. Degrades cleanly to mobile: hero + card stacks, trust bar + bottom nav appear at the bottom — matches the approved wireframe exactly

## Design Tokens

Create at `src/lib/design/tokens.ts`:

```ts
// Exact values from the approved sketch. Do not introduce new values.
export const colors = {
  purple:     '#2d1b69',  // brand primary, hero gradient start, CTA start, total highlight
  green:      '#1a6b3c',  // brand secondary, hero gradient end, CTA end, receive amount, green row values
  greenLight: '#7dd87d',  // "leaf" in logo
  gold:       '#ffd700',  // future: AUSTRAC / Minutes icon accents
  bgSoft:     '#f0faf0',  // Best Rate pill background, sidebar active state
  ink:        '#1a1a2e',  // primary text / amount
  muted:      '#888',     // labels, secondary text
  border:     '#eee',     // dividers, borders
  chipBg:     '#f0f0f0',  // currency badge background
  cardBg:     '#ffffff',
  pageBg:     '#f5f5f5',
} as const;

export const gradient = `linear-gradient(135deg, ${colors.purple} 0%, ${colors.green} 100%)`;

export const radius = {
  card:    '16px',
  chip:    '20px',
  rateBar: '8px',
  cta:     '12px',
  hero:    '24px', // Variant D gradient frame
  flag:    '2px',
} as const;

export const type = {
  logo:         { size: '22px', weight: 700, letterSpacing: '-0.5px' },
  tagline:      { size: '13px', weight: 400, opacity: 0.8 },
  fieldLabel:   { size: '11px', weight: 400, letterSpacing: '0.5px', transform: 'uppercase' },
  amount:       { size: '36px', weight: 700 },
  currencyCode: { size: '13px', weight: 600 },
  rateBar:      { size: '13px', weight: 600 },
  rowLabel:     { size: '14px', weight: 400 },
  rowValue:     { size: '14px', weight: 600 },
  rowTotal:     { size: '14px', weight: 700 },
  cta:          { size: '16px', weight: 700, letterSpacing: '0.3px' },
  trustLabel:   { size: '11px', weight: 600 },
  trustSub:     { size: '11px', weight: 400 },
  trustIcon:    { size: '18px' },
  navLabel:     { size: '10px', weight: 400 },
  navIcon:      { size: '20px' },
  heroHeadline: { size: '32px', weight: 700, letterSpacing: '-0.5px', lineHeight: 1.15 },
} as const;

export const spacing = {
  cardPad:      '24px',
  rateBarPad:   '10px 14px',
  chipPad:      '6px 12px',
  rowGap:       '14px',
  ctaPad:       '16px',
  trustBarPad:  '10px 24px',
  bottomNavPad: '12px 0 28px',
  heroPad:      '24px',
} as const;

export const shadow = {
  card:   '0 4px 20px rgba(0,0,0,0.08)',
  lifted: '0 24px 60px rgba(0,0,0,0.25)',  // Variant D gradient frame
} as const;

export const flag = {
  au: 'linear-gradient(#00008b 40%, #fff 40% 43%, #c8102e 43%)',
  ng: 'linear-gradient(90deg, #008751 33%, #fff 33% 66%, #008751 66%)',
  size: { width: '20px', height: '14px' },
} as const;
```

## Files to Create

- [ ] `src/lib/design/tokens.ts` — design tokens (above)
- [ ] `src/components/design/KolaLogo.tsx`
- [ ] `src/components/design/Tagline.tsx`
- [ ] `src/components/design/CurrencyBadge.tsx`
- [ ] `src/components/design/TransferCard.tsx`
- [ ] `src/components/design/TrustBar.tsx`
- [ ] `src/components/design/BottomNav.tsx`
- [ ] `src/components/design/SidebarNav.tsx`
- [ ] `src/components/design/FieldLabel.tsx`
- [ ] `src/components/design/Flags.tsx` (FlagAU, FlagNG)
- [ ] `src/components/layout/DashboardShell.tsx` — Variant D shell (sidebar + main with gradient hero)

## Files to Modify

### User-facing (Wave 1 priority order)

1. **`src/app/(dashboard)/send/page.tsx`** — Hero. Swap placeholder JSX for Variant D layout with real `TransferCard` wired to existing API (rate, recipients, submit).
2. **`src/app/(dashboard)/activity/page.tsx`** — DashboardShell without gradient hero; white table-card on `#f5f5f5` for transfers list. Reuse `TransferCard`'s typography tokens for amounts.
3. **`src/app/(dashboard)/recipients/page.tsx`** — DashboardShell; card grid on `#f5f5f5`. Add/edit modals use `CurrencyBadge`, `FieldLabel`, same CTA style.
4. **`src/app/(dashboard)/account/page.tsx`** — DashboardShell; settings sections as white cards on `#f5f5f5`. KYC status row uses green/gold accents.
5. **`src/app/(dashboard)/layout.tsx`** — Apply `DashboardShell` (sidebar + top chrome).

### Auth (follow-up)

6. **`src/app/(auth)/login/page.tsx`** — Full-page gradient hero with centered white auth card (use same `card` shape/shadow as `TransferCard`).
7. **`src/app/(auth)/register/page.tsx`** — Same pattern as login.

### Admin (follow-up)

8. **`src/app/admin/*`** — Light DashboardShell variant (no gradient hero). Data-dense tables on `#f5f5f5`. No gradient on admin screens — keep purple as accent only (active nav, small highlights).

## Implementation Steps

### Step 1 — Tokens & primitives (1-2 hrs)

1. Create `src/lib/design/tokens.ts` with the values above.
2. Extract reusable components from `.claude-design/lab/components/KolaPrimitives.tsx` into `src/components/design/`. Split one-component-per-file so each can be tree-shaken and tested independently.
3. Add exported types where props are reused (`<CurrencyBadge code="AUD" | "NGN">`, `<SidebarNav active="Send" | "Activity" | "Recipients" | "Account">`).

### Step 2 — Dashboard shell (1 hr)

1. Create `src/components/layout/DashboardShell.tsx` accepting two slots:
   - `hero` (optional) — for the Send page's gradient frame + headline
   - `children` — main content area
2. Props: `{ active: NavKey, hero?: ReactNode, children: ReactNode }`
3. Renders the sidebar from Variant D on `md+`, bottom nav on `md-`. `TrustBar` between content and bottom nav on mobile.

### Step 3 — Send page (2-3 hrs)

1. Replace `src/app/(dashboard)/send/page.tsx` body with `<DashboardShell active="Send" hero={<SendHero />}><SendFormFromTransferCard /></DashboardShell>`.
2. `SendHero` = left column (headline + chips) from Variant D.
3. Right column gradient frame contains `<TransferCard>` — wire to existing API:
   - amount input → state
   - rate → `GET /api/rates/current` (already exists)
   - recipient select → `GET /api/recipients` (already exists)
   - Submit → `POST /api/transfers` (already exists)
4. Preserve copy/labels from the approved sketch. Use token values exclusively.

### Step 4 — Other dashboard pages (2 hrs)

For Activity, Recipients, Account:
1. Wrap in `<DashboardShell active={...}>` (no `hero` prop).
2. Replace ad-hoc JSX with white cards using `radius.card`, `shadow.card`, `colors.border`.
3. Use `FieldLabel` for column headers, `type.amount` for amounts, green row tone for positive outcomes.

### Step 5 — Auth pages (1 hr)

1. Full-bleed gradient background.
2. Centered white card — same shape as `TransferCard` (same `radius.card`, `spacing.cardPad`, `shadow.card`).
3. Inside: Kolaleaf logo (large), form fields with `FieldLabel`, gradient CTA button (`spacing.ctaPad`, `radius.cta`, `type.cta`).

### Step 6 — Admin pages (2 hrs)

1. Light `DashboardShell` variant with distinct sidebar active color (keep purple active state; skip gradient hero).
2. Data tables: white surfaces, muted labels, green/red status pills for transfer states.

## Component API Reference

### `<TransferCard>`

Props:
- `amount: number` — initial AUD amount (default `1000`)
- `onAmountChange?: (n: number) => void`
- `recipient?: Recipient` — selected recipient (shows inline if provided)
- `rate: { customerRate: number; effectiveAt: Date }` — from rate API
- `onSubmit: () => void`
- `submitting?: boolean` — disable CTA + show loading state
- `error?: string` — inline error above CTA

States:
- **Default** — amount entered, recipient chosen, rate valid
- **Loading (rate)** — shimmer on Best Rate pill
- **Rate stale** — yellow border on rate pill, "Rate refreshing..." sub-copy
- **Submitting** — CTA shows spinner, disabled
- **Error** — red inline text above CTA
- **KYC pending** — CTA replaced with "Verify identity to send" linking to account

### `<DashboardShell>`

Props:
- `active: 'Send' | 'Activity' | 'Recipients' | 'Account'`
- `hero?: ReactNode` — optional gradient hero content (Send only)
- `children: ReactNode`

## Required UI States

For every page:

- **Loading** — skeleton on cards, shimmer on amount/rate values
- **Empty** — Activity/Recipients empty states use centered `FieldLabel` + subtle CTA
- **Error** — banner at top of content area, red `colors`, dismissable
- **Disabled** — CTA opacity 0.5, cursor not-allowed
- **Mobile menu open** — bottom nav active state highlights current screen

## Accessibility Checklist

- [ ] Amount input has `<label>` and `aria-label="Amount in AUD"`
- [ ] Currency badges are `role="presentation"` (decoration next to input)
- [ ] Best Rate pill is `<output>` so screen readers announce updates
- [ ] Summary rows use `<dl><dt><dd>` semantics
- [ ] Send Money button has `aria-busy` when submitting
- [ ] Sidebar nav is `<nav aria-label="Primary">`
- [ ] Bottom nav is `<nav aria-label="Primary mobile">` with same items — one nav visible at a time via `md:hidden` / `hidden md:block`
- [ ] All interactive elements have `:focus-visible` outline using `colors.purple`
- [ ] Gradient CTAs meet 4.5:1 contrast on white text (test both ends of gradient)
- [ ] Touch targets minimum 44×44px (CTA, nav items)
- [ ] Reduced motion: disable CTA hover brightness transition when `prefers-reduced-motion: reduce`

## Dark Mode Strategy

Required from day 1 per the brief, but the agreed design is **light-first**. Strategy:

- Light: as defined in tokens above
- Dark: `pageBg → #0b0b14`, `cardBg → #16162a`, `ink → #f2f2f7`, `muted → #8e8ea0`, `border → #24243a`, `chipBg → #1f1f36`, `bgSoft → rgba(26,107,60,0.15)`
- Gradient stays identical in dark mode (it's the brand anchor)
- Greens and purples unchanged — just the neutrals shift

Do not implement dark mode in Step 1. Ship light first, add dark tokens in a follow-up once the system is stable.

## Testing Checklist

- [ ] Visual regression test per breakpoint (375, 768, 1280) for Send, Activity, Login
- [ ] Interaction: amount change → NGN updates within 50ms, rate refresh animation runs
- [ ] Lighthouse accessibility 95+
- [ ] Cross-browser: Safari 17+, Chrome 120+, Firefox 120+
- [ ] Mobile Safari address bar overscroll does not expose light/dark seam

## Files Removed (Cleanup)

- `.claude-design/` (entire directory)
- `src/app/design-lab/page.tsx`
- `src/app/design-lab/` (directory)

---

*Generated by design-and-refine workflow. The winning Variant D code is preserved below as reference.*

## Reference: Variant D source

The code below was extracted from `.claude-design/lab/variants/VariantD.tsx` and its dependencies. Use as the starting template when implementing Step 3.

### VariantD.tsx

```tsx
import { KolaLogo, Tagline, TransferCard, SidebarNav, BottomNav, TrustBar, GRADIENT, colors, shadow } from '@/components/design';

export default function SendPage() {
  return (
    <div className="grid md:grid-cols-[220px_1fr] min-h-screen" style={{ background: colors.pageBg }}>
      <div className="hidden md:block">
        <SidebarNav active="Send" />
      </div>

      <main className="flex flex-col">
        <section className="flex-1 grid md:grid-cols-2 gap-8 p-6 md:p-12 items-center">
          <div>
            <div style={{ fontSize: '11px', color: colors.muted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Send money to Nigeria
            </div>
            <h1 className="mt-3" style={{ fontSize: '32px', fontWeight: 700, lineHeight: 1.15, color: colors.ink, letterSpacing: '-0.5px' }}>
              Better rates.<br />Delivered in minutes.
            </h1>
            <p className="mt-3 max-w-sm" style={{ fontSize: '14px', color: colors.muted, lineHeight: 1.55 }}>
              AUSTRAC-registered. Zero fees. Built by Nigerian-Australians who know the corridor.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Chip icon="🔒" label="AUSTRAC Registered" />
              <Chip icon="⚡" label="Minutes delivery" />
              <Chip icon="★" label="4.8/5 · 1,247 reviews" />
            </div>
          </div>

          <div className="flex justify-center md:justify-end">
            <div className="relative p-6 md:p-8" style={{ background: GRADIENT, borderRadius: '24px', boxShadow: shadow.lifted }}>
              <div className="mb-5 text-white">
                <KolaLogo />
                <div className="mt-1"><Tagline /></div>
              </div>
              <TransferCard />
            </div>
          </div>
        </section>

        <div className="hidden md:block"><TrustBar /></div>
        <div className="md:hidden">
          <TrustBar />
          <BottomNav active="Send" />
        </div>
      </main>
    </div>
  );
}

function Chip({ icon, label }: { icon: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5" style={{ background: colors.cardBg, border: `1px solid ${colors.border}`, padding: '6px 12px', borderRadius: '999px', fontSize: '12px', color: colors.ink, fontWeight: 600 }}>
      <span>{icon}</span>{label}
    </span>
  );
}
```

### TransferCard source

See `.claude-design/lab/components/KolaPrimitives.tsx` (archived in git history of the design-lab cleanup commit). Copy its `TransferCard`, `KolaLogo`, `Tagline`, `CurrencyBadge`, `FieldLabel`, `FlagAU`, `FlagNG`, `TrustBar`, `BottomNav`, `SidebarNav` into `src/components/design/` one file per component.
