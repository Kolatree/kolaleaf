# Agent Instructions

## Persona

- Address the user as Ambrose.
- Optimize for correctness, reversibility, and regulatory safety over speed.
- Be direct and specific. If a document is stale, say so and use the newer source.

## Project Summary

- Kolaleaf is an AUD-to-NGN remittance platform.
- The product thesis is not "cheap transfers" in isolation. The app is the distribution layer for an AUD float engine.
- Core wedge: AUD to NGN bank transfer, fast delivery, strong trust signals, competitive rate, no explicit fee at launch.
- Regulatory posture matters: AUSTRAC obligations, immutable audit logging, KYC gating, reconciliation, suspicious matter detection, and long-lived records are first-order requirements.

## Source Of Truth Order

When documents disagree, use this order:

1. Original product strategy/spec in `~/.gstack/projects/Kolaleaf/ao-unknown-design-20260414-081002.md`
2. Approved send-screen design artifacts in `~/.gstack/projects/Kolaleaf/designs/send-screen-20260414/approved-wireframe.html` and `approved.json`
3. Repo architecture and operating constraints in `CLAUDE.md`
4. Web UI implementation details in `DESIGN_PLAN.md`
5. Sequential engineering execution plans in `handoff/PILE-B-PLAN.md` and `handoff/WAVE-1-AUDIT.md`
6. Actual current state in `handoff/BUILD-LOG.md`

Important:

- `handoff/HANDOVER.md` is historical context for the Step 15 era. Do not treat it as the current state if it conflicts with `handoff/BUILD-LOG.md`.
- The repo-local plans are downstream codifications of the original `gstack` planning artifacts, not the origin.

## Approved Product And Design Direction

- Product direction: full mobile app plus web presence, with the web app shipping first and mobile in parallel.
- Visual direction: purple-to-green gradient, white transfer card, trust bar above bottom navigation, no dead white space.
- The approved send screen is the baseline visual reference. Do not casually drift from it on key remittance surfaces.
- UX is not decorative in this product. It is part of the trust model.

## Current State

- The repository has moved beyond the early "web app production-ready" handover notes.
- `handoff/BUILD-LOG.md` is the live status tracker.
- Wave 1 hardening steps 26-32 are complete locally.
- Pile B steps 20-25 are also implemented locally; Step 19 is the pushed baseline.
- Current code includes:
  - `/api/v1` versioning
  - Zod + OpenAPI contracts
  - `User.state` Postgres enum
  - BullMQ email queue + `FailedEmail`
  - user soft-delete via `deletedAt`
  - observability foundation with `pino` and request IDs

## Repository Guidelines

### Read This First

- Start with `CLAUDE.md`.
- For planning questions, check the relevant `gstack` source before relying on handoff summaries.
- For implementation status, read `handoff/BUILD-LOG.md` before `handoff/HANDOVER.md`.

### Project Structure

- `src/app/` contains the Next.js App Router UI and route handlers.
- `src/lib/` contains core domain logic: auth, transfers, rates, KYC, compliance, observability, queues, reconciliation.
- `src/workers/` contains worker processes.
- `prisma/` contains schema and migrations.
- `tests/` contains the Vitest suite, including e2e-style coverage.
- `handoff/` contains architect briefs, review requests, build log, and audit plans.

### Commands

- `npm run dev` — local app
- `npm run build` — production build
- `npm test -- --run` — test suite
- `npx tsc --noEmit` — type-check
- `npm run worker` — webhook/background worker

Inspect `package.json` before assuming any other scripts exist.

### Engineering Standards

- Follow the Three Man Team intent even when working solo: brief the task clearly, build narrowly, review critically.
- Prefer TDD for non-trivial changes.
- Preserve auditability. Do not delete or weaken audit records without an explicit, documented policy decision.
- Treat auth, transfers, compliance, provider integrations, and schema changes as production-sensitive.
- Prefer small, reversible changes. Call out migration or deployment risk explicitly.

### Design Standards

- Preserve the approved Variant D direction on user-facing remittance flows.
- Keep user-facing pages light-first unless an existing surface clearly establishes a different pattern.
- Reuse existing design tokens and primitives before introducing new visual values.

### Documentation Discipline

- If you discover a stale or misleading doc during work, prefer updating it or explicitly noting the conflict in your final handoff.
- Do not create a second competing "source of truth" when an existing one should be corrected.

## Safety

- Never use destructive git commands like `git reset --hard` without explicit approval.
- Do not assume prod deploy state from local code state.
- If full-repo validation surfaces pre-existing failures, treat them as in scope unless Ambrose says otherwise.
