# Pile B Plan — Steps 19–25
*Written by Arch. One file, seven steps. Each step gets its own ARCHITECT-BRIEF and BUILD-LOG entry as we go.*

---

## Context

`/simplify` pass (commit `51a885f`) closed out Pile A from `/ce:review`. Pile B is seven
non-trivial items each deserving its own session. This file is the sequencing contract.
Rule still holds: **Step N+1 does not start until Step N is deployed and logged in
`handoff/BUILD-LOG.md`.**

---

## Dependency Graph

```
Step 19  /api/v1 versioning ────────┐
                                     ├──► Step 20  Zod + OpenAPI ──► Step 21  Discriminated-union identifier body
Step 22  User.state Postgres enum  (independent)
Step 23  BullMQ email queue         (independent, Redis already on Railway)
Step 24  Observability              (LAST — tags versioned routes)
Step 25  Legacy test-user cleanup   (data hygiene; can slot in anywhere)
```

Chosen sequence (cheap-first, boundary-first, observability-last):

| # | Step | Blocks | Session scope | Rough LOC |
|---|---|---|---|---|
| 19 | `/api/v1` versioning | 20, 21, 24 | Route move + redirects + client rewrite | ~400 |
| 20 | Zod + OpenAPI contracts | 21 | Typed boundaries, generated spec | ~800 |
| 21 | Discriminated-union identifier body | — | Schema refinement on top of 20 | ~150 |
| 22 | `User.state` Postgres enum | — | Schema migration + Prisma | ~200 |
| 23 | BullMQ email queue | — | Worker, Redis, dead-letter, reap job | ~500 |
| 24 | Observability | — | Logger, request IDs, `/metrics`, traces | ~600 |
| 25 | Legacy test-user cleanup | — | One-shot script, logged | ~50 |

---

## Phase 0 — Parallel Research (THIS SESSION)

Seven scout agents, one per step, each ≤200-word structured report. Reports land in
`handoff/RESEARCH-PILE-B/<step>.md` and feed Step-19's ARCHITECT-BRIEF.

Exit criterion: all seven reports written, main context NOT polluted with raw file dumps.

---

## Phase 1..7 — Sequential Implementation

For each step:
1. Arch writes `handoff/ARCHITECT-BRIEF-STEP-NN.md` (using research + prior-step learnings).
2. Bob implements TDD-first. Tests fail → tests pass → verify → `handoff/REVIEW-REQUEST-STEP-NN.md`.
3. Richard reviews only the files Bob listed → `handoff/REVIEW-FEEDBACK-STEP-NN.md`.
4. Bob addresses feedback.
5. Arch deploys + logs in `handoff/BUILD-LOG.md`.
6. Next step unlocks.

---

## Non-Goals (Pile C, future)

- Rate engine hardening (separate wave)
- Mobile apps (Wave 2)
- Admin dashboard redesign
- Multi-corridor expansion (config only, not code)
