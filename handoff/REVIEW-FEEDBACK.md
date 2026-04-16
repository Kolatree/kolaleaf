# Review Feedback — Step 15k
Date: 2026-04-15
Ready for Builder: YES

## Must Fix
None.

## Should Fix
- `src/app/(marketing)/compliance-info/page.tsx:80-82` — "Consumer protection"
  section states "We separate customer funds from operating funds." This is a
  factual operational claim, not a statutory restatement like the seven-year
  retention line. If end-to-end segregation is not yet in place (the float engine
  is still Wave 1), soften to something like "We operate our float with customer
  funds segregated from operating funds — final treasury arrangements pending
  counsel review," or hedge the sentence under the same "placeholder" framing
  the rest of the page uses. The amber banner covers the page generally, but a
  literal reading of this one sentence asserts a current-state control that the
  build may not yet have. Log to BUILD-LOG if not addressed now.

## Escalate to Architect
None.

## Cleared
Reviewed 4 source files + 1 test file (privacy/terms/compliance-info `page.tsx`,
`site-header.tsx`, `marketing-pages.test.tsx`) plus `site-footer.tsx` for link
hygiene.

**Content.** All three pages render the amber "Pending legal review" banner
ABOVE the H1 via `<LegalBanner />`, with `role="note"` and an explicit
`aria-label="Legal review pending"`. Each page also prints "Last updated:
placeholder date — pending legal review" below the H1. The AUSTRAC number
`IND100512345` is flagged inline as placeholder and matches the footer. The
seven-year retention statement is correctly framed as a statutory obligation
under the AML/CTF Act, not a Kolaleaf-invented commitment. Terms "Governing
law" explicitly hedges NSW jurisdiction as placeholder. No invented AFCA
member numbers, no concrete SLA commitments, no escape-hatch language that
could be read as final policy.

**Mobile hamburger.** `'use client'` present. Desktop nav (`hidden md:flex`)
content is unchanged. Mobile toggle is `md:hidden`, 40×40, has `aria-expanded`,
`aria-controls` bound via `useId()`, and a dynamic `aria-label` that flips
between "Open menu" and "Close menu". ESC handler is correctly mounted and
cleaned up inside `useEffect` keyed on `open`. Outside-click handled via a
transparent `fixed inset-0` sibling button, only rendered when `open === true`
so it never blocks initial paint. Every `MobileLink`, the gradient CTA, and
the logo link all call `setOpen(false)` onClick — returning to a page will not
leave the menu open. Z-index stacking is correct (catcher z-10, panel z-20).
No server-only APIs used in the client component.

**Metadata.** All three pages export a `Metadata` object with `title` and
`description`.

**Link hygiene.** Footer routes `/privacy`, `/terms`, `/compliance-info` match
the new folder names exactly under `src/app/(marketing)/`.

**Tests.** `npx vitest run tests/app/marketing-pages.test.tsx` → 3 passed, 0
failed. `npx tsc --noEmit` → clean. The test walker invokes parameterless
function components so helper components (`<LegalBanner />`, `<Section />`)
contribute to the asserted text; the divergence from the admin/page walker is
documented in a comment block in the file.

**Scope.** `git status --short` shows only the files Bob listed in
REVIEW-REQUEST (plus BUILD-LOG and REVIEW-REQUEST). No new deps, no schema
changes, no new primitives, no out-of-scope drift.

Step 15k is clear.
