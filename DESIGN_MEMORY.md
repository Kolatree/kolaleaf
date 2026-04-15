# Design Memory — Kolaleaf

Single source of truth for visual decisions. Update when decisions evolve.

## Brand Tone
- **Adjectives:** Premium · Trustworthy · Warm · Nigerian-Australian
- **Avoid:** Dark-mode-first aesthetics · gradient fatigue · generic fintech neutrality · fee-heavy copy
- **North star:** The Nigerian diaspora in Australia must feel this is *theirs* — purple for premium fintech, green for Nigeria, gold accents for trust signals.

## Layout & Spacing
- **Density:** Comfortable (Wise/WorldRemit-like, not Revolut-dense)
- **Base page:** `#f5f5f5`
- **Card:** 16px radius, 24px padding, `0 4px 20px rgba(0,0,0,0.08)` shadow
- **Hero (Variant D gradient frame):** 24px radius, `0 24px 60px rgba(0,0,0,0.25)` lifted shadow
- **Sidebar width:** 220px (desktop only; bottom nav at `<md`)
- **Active nav:** `#f0faf0` background + `#1a6b3c` text

## Typography
- **Font:** Geist Sans (body), Geist Mono available for future tabular ops
- **Logo:** 22px / 700 weight / `-0.5px` tracking
- **Headline (hero):** 32px / 700 / `-0.5px` tracking / 1.15 line-height
- **Amount:** 36px / 700 tabular-nums
- **Field label:** 11px / uppercase / `0.5px` tracking / `#888`
- **Detail row:** 14px label muted / 14px value bold
- **CTA:** 16px / 700 / `0.3px` tracking
- **Trust / nav label:** 10-11px

## Color System
| Token | Hex | Role |
|-------|-----|------|
| `purple` | `#2d1b69` | Brand primary, gradient start, total highlight, nav active text |
| `green` | `#1a6b3c` | Brand secondary, gradient end, receive amount, fee/time green values |
| `greenLight` | `#7dd87d` | "leaf" in logo, dark-mode accents |
| `gold` | `#ffd700` | Reserved for icon accents (AUSTRAC, Minutes) |
| `bgSoft` | `#f0faf0` | Best Rate pill, sidebar active bg |
| `ink` | `#1a1a2e` | Primary text |
| `muted` | `#888` | Labels, secondary text |
| `border` | `#eee` | Dividers |
| `chipBg` | `#f0f0f0` | Currency badge |
| `cardBg` | `#ffffff` | All cards, sidebar, nav |
| `pageBg` | `#f5f5f5` | Page background |

**Gradient:** `linear-gradient(135deg, #2d1b69 0%, #1a6b3c 100%)` — used as inline CSS, NOT `bg-gradient-to-br`.

## Interaction Patterns
- **Forms:** Inline labels (small caps above field), large input, currency badge on the right
- **Modals/Drawers:** Avoid modals for primary flows. Prefer inline expansion or dedicated routes.
- **Tables/Lists:** White card rows with `#eee` dividers; avatar circles use the gradient for recipient initials
- **Feedback:** Inline error under the CTA (red), optimistic UI for amount→NGN conversion, toast for transfer-state changes
- **CTA:** Single purple→green gradient button per view. Never two primary CTAs side by side.
- **Hover:** `hover:brightness-110` on gradient buttons. No shadows shifting on hover (causes layout jitter).

## Accessibility Rules
- **Focus:** Visible `:focus-visible` outline using `#2d1b69` at 2px with 2px offset
- **Labels:** Every input has a `<label>` or `aria-label`. Currency badges are `role="presentation"`
- **Rate pill:** Rendered as `<output>` so changes are announced
- **Motion:** Respect `prefers-reduced-motion: reduce` — disable hover transitions and gradient shimmer
- **Touch target:** 44×44px minimum (CTA, nav items, chips)
- **Contrast:** White on gradient tested at both color ends (passes 4.5:1 at green end; passes 4.5:1 at purple end)

## Repo Conventions
- **Tokens location:** `src/lib/design/tokens.ts`
- **Primitives location:** `src/components/design/KolaPrimitives.tsx`
- **Styling approach:** Tailwind v4 for layout and spacing classes; inline `style={{}}` for token values (colors, specific px values, gradient). This keeps tokens traceable and prevents Tailwind arbitrary-value drift.
- **Client vs Server:** Design primitives are `'use client'` by default because they include interactive forms. Refactor to server where no handlers are needed.
- **Variant D is the reference:** All pages follow the shell + optional hero + light body + trust-bar pattern.

## Dark Mode
- Required from day 1 per brief, but implement **light first**. Dark tokens defined in `DESIGN_PLAN.md` — ship in a follow-up once the light system is stable.

## Primitives Available
Located at `src/components/design/KolaPrimitives.tsx`:

- `KolaLogo({ size, tone })`
- `Tagline({ tone })`
- `FlagAU()` / `FlagNG()`
- `CurrencyBadge({ code })`
- `FieldLabel({ children })`
- `TransferCard({ amountAud, rateCustomer, onSubmit, ... })`
- `TrustBar({ rating })`
- `BottomNav({ active })`
- `SidebarNav({ active })`
- `DashboardShell({ active, hero, children })`

---

*Updated 2026-04-15 by design-and-refine. Extend this file; do not duplicate decisions elsewhere.*
