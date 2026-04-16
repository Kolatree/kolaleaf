# Review Request -- Step 15k

**Step:** 15k -- Public stub pages + mobile hamburger menu
**Date:** 2026-04-15
**Builder:** Bob
**Ready for Review:** YES

---

## Summary

Two small changes, both behind the public-chrome surface:

1. **Three public stub pages** (`/privacy`, `/terms`, `/compliance-info`)
   now render instead of 404. Each is a server component wearing the
   existing marketing chrome, with a prominent "Pending legal review"
   banner at the top and 6–7 sections of tasteful placeholder copy.
2. **Mobile hamburger menu** on `SiteHeader`. Desktop behaviour is
   unchanged. Mobile viewport now shows a 40x40 hamburger button; tap
   opens a dropdown containing all nav links + the gradient
   "Start sending" CTA. Closes on link tap, ESC, and outside click.

No new dependencies. No schema migrations. No new primitives. Only
Variant D tokens.

---

## Files to Review

### New files

- `src/app/(marketing)/privacy/page.tsx` -- privacy stub. Server
  component. `<LegalBanner />` + `<Section />` helpers. 6 sections
  (collection, purpose, storage, sharing, rights, contact).
  `export const metadata`.
- `src/app/(marketing)/terms/page.tsx` -- terms stub. Same shape as
  privacy. 7 sections (eligibility, your/our responsibilities,
  prohibited uses, limitation, NSW governing law, contact).
- `src/app/(marketing)/compliance-info/page.tsx` -- compliance stub.
  Same shape. 6 sections (AUSTRAC registration, AML/CTF program,
  reporting obligations, fraud controls, consumer protection, contact).
  Placeholder AUSTRAC number `IND100512345` matches the footer.
- `tests/app/marketing-pages.test.tsx` -- 3 render-smoke tests, one
  per page. Walks the rendered tree (including function-component
  children) and asserts the "Pending legal review" text plus each
  page's H1 appear.

### Modified files

- `src/app/_components/site-header.tsx` -- replaced the always-visible
  "Sign in / Start sending" mobile fallback with a hamburger toggle
  (`md:hidden`) + mobile dropdown panel. Desktop nav (`hidden md:flex`)
  is unchanged in content. Added `useState` + `useId` + ESC handler.
  Click-outside handled via a transparent sibling button. Inline SVG
  icon — no new deps.

### Docs

- `handoff/BUILD-LOG.md` -- Step 15k entry + Known Gaps items
  (`/privacy` `/terms` `/compliance-info` stubs; mobile hamburger)
  struck through.

---

## Key Decisions

- **Server components for legal pages.** No client interactivity needed.
  The `(marketing)/layout.tsx` chrome wraps them automatically.
- **Banner prominence.** Amber background (#fff7e0 / #f0c040 border),
  `role="note"` with `aria-label="Legal review pending"`, renders
  above the H1 so users can't miss it. Includes the escalation email
  (support / compliance / legal depending on page).
- **Hamburger renders inline, not `fixed`.** Avoids SSR layout-shift
  and works with the sticky translucent header. The click-catcher is
  `fixed inset-0` but only renders when `open === true`, so it never
  blocks anything on initial paint.
- **`useId()` for aria-controls.** Keeps button/panel pairing correct
  under React concurrent rendering without hardcoding IDs.
- **Test walker invokes function components.** The admin/page test's
  `collectStrings` skips function components deliberately; this suite's
  version invokes them (wrapped in a `try/catch`) so that helper
  components like `<LegalBanner />` contribute to the asserted text.
  Comment in the file explains why the two copies differ.

---

## Verification

- `npx tsc --noEmit` -- 0 errors
- `npm test -- --run` -- 599 passed (596 baseline + 3 new), 0 failures
- Render-smoke via Vitest confirms each page returns a non-null tree
  with the "Pending legal review" banner and the page H1 present.
- Footer links in `site-footer.tsx` already point at `/privacy`,
  `/terms`, `/compliance-info` -- the new route files match those
  paths exactly.

Not performed in this step (reviewer, please spot-check in dev):
- Browser-based smoke with `npm run dev` of the three new routes.
- Browser-based check of the mobile hamburger in a < 768px viewport
  (open/close via tap, ESC, outside-click).

---

## Open Questions

None. Scope matches the brief exactly.

---

## Known Gaps (not in scope of this step)

The legal copy is placeholder. The banner explicitly says so. Final
copy lands after counsel review before public launch.

---

## Ready for Review: YES
