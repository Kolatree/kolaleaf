# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Kolaleaf** is an AUD-to-NGN remittance platform. It is a licensed AUD float engine that distributes value through remittance pricing. The app is the distribution channel for a treasury business.

Every engineering decision should be evaluated against: "Does this increase the AUD we hold, the duration we hold it, or the yield we extract?"

**Regulatory context:** AUSTRAC-registered money transmitter. AML/CTF compliance is non-negotiable. All authentication events, state transitions, and admin actions must be logged immutably. Records retained 7 years per the AML/CTF Act.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Web frontend | Next.js 15 + TypeScript + Tailwind |
| Mobile (iOS) | Native Swift |
| Mobile (Android) | Native Kotlin |
| Backend API | Node.js + Express/Hono + TypeScript |
| Database | PostgreSQL (on Railway) |
| Auth | Custom (PG sessions + bcrypt + TOTP 2FA) |
| Identity | One user, multiple identifiers (email, phone, Apple, Google) |
| KYC | Sumsub.com |
| AUD collection | Monoova PayID API |
| NGN payout | Flutterwave (primary) + Paystack (fallback) |
| Rate engine | Automated FX API (15-min refresh) + admin override |
| Hosting | Railway (everything: web, API, workers, DB) |
| Queues | Bull/BullMQ on Redis (payout retries, reconciliation, compliance) |

## Architecture

```
                    ┌─────────────┐
                    │   Railway    │
                    │   (CDN/LB)  │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
     ┌────────┴───┐  ┌────┴────┐  ┌────┴────┐
     │  Web App   │  │ Mobile  │  │  Admin   │
     │  (Next.js) │  │ (native)│  │Dashboard │
     └────────┬───┘  └────┬────┘  └────┬────┘
              │            │            │
              └────────────┼────────────┘
                           │
                    ┌──────┴──────┐
                    │ Backend API │─── Background Workers
                    │  (Node.js)  │    (reconciliation,
                    └──────┬──────┘     retries, alerts)
                           │
         ┌─────────┬───────┼───────┬─────────┐
         │         │       │       │         │
    ┌────┴──┐ ┌────┴──┐ ┌──┴──┐ ┌──┴───┐ ┌──┴───┐
    │Custom │ │Sumsub │ │ PG  │ │ Rate │ │Notify│
    │ Auth  │ │  KYC  │ │ DB  │ │Engine│ │System│
    └───────┘ └───────┘ └─────┘ └──────┘ └──────┘
                           │
              ┌────────────┼────────────┐
              │                         │
       ┌──────┴──────┐          ┌───────┴──────┐
       │  Monoova    │          │ Flutterwave  │
       │  (PayID)    │          │ / Paystack   │
       └─────────────┘          └──────────────┘
```

## Transfer State Machine

This is the backbone. Every screen, notification, and admin action maps to a state transition.

```
CREATED ──► AWAITING_AUD ──► AUD_RECEIVED ──► PROCESSING_NGN
   │              │                │                 │
   │         (24h timeout)    (FX locked)    ┌───────┼───────┐
   │              │                │         │       │       │
   │              ▼                │         ▼       ▼       ▼
   │          EXPIRED              │    NGN_SENT NGN_FAILED NGN_RETRY
   │                               │         │       │    (max 3x)
   │                               │         ▼       │       │
   │                               │    COMPLETED    ▼       ▼
   │                               │            NEEDS_MANUAL◄┘
   │                               │                 │
   │                               │                 ▼
   │                               │             REFUNDED
   │
   └──► CANCELLED (user-initiated before AUD received)

Special states:
  FLOAT_INSUFFICIENT — NGN float too low, transfer paused until topped up
```

## Critical Design Decisions

- **KYC gates PayID.** Do not generate a PayID reference until Sumsub KYC is approved. Users cannot push AUD before verification. This prevents holding unverified funds.
- **Webhook idempotency required.** Store webhook event IDs. Skip duplicates. Both Monoova and Flutterwave retry webhooks. Without idempotency, double payouts are possible.
- **Webhook handlers must be fast.** Acknowledge immediately (200 OK), process via queue. Never block the webhook response on DB writes or external API calls.
- **Rate staleness alerting.** If rate not updated in 12h, alert admin. If 24h, block new transfers. Admin-facing only, never shown to users.
- **Float monitoring.** Real-time NGN float balance tracking. Auto-pause new transfers when float drops below threshold. Alert admin for top-up.
- **Daily reconciliation.** Automated job diffs internal ledger against Monoova and Flutterwave statements. Flags mismatches for human review. AUSTRAC requirement.
- **Multi-corridor from day 1.** Schema supports any currency pair. Launch with AUD-NGN only. Adding a new corridor is a config change, not a code change.
- **Provider failover.** Flutterwave primary, Paystack fallback. Track which provider handles each transfer. Route webhooks accordingly.

## Core Database Tables

```
users, user_identifiers, recipients, transfers, transfer_events (audit),
corridors, rates, rate_feeds, referrals, compliance_reports
```

`transfer_events` is the immutable audit log. Every state transition records: from_status, to_status, actor (user|system|admin), metadata (jsonb), timestamp. Never delete rows from this table.

## Development Workflow — Three Man Team

Development uses an AI agent workflow defined in ARCHITECT.md, BUILDER.md, and REVIEWER.md:

- **Arch** (Architect): Owns decisions, writes briefs to `handoff/ARCHITECT-BRIEF.md`, spins up Bob, manages deploys
- **Bob** (Builder): Builds per brief, writes to `handoff/REVIEW-REQUEST.md` when done
- **Richard** (Reviewer): Reviews only files Bob listed, writes to `handoff/REVIEW-FEEDBACK.md`

Handoff files live in `handoff/`. One step at a time. Step N+1 does not start until Step N is deployed and logged in `handoff/BUILD-LOG.md`.

## Testing Strategy

Full TDD. Tests first for everything. Priority order by blast radius:
1. Transfer state machine (every transition)
2. Payment webhook handlers (idempotency, signatures, ordering)
3. Payout orchestration (retry logic, failover)
4. Auth flows (login, 2FA, session management, force-logout)
5. KYC integration (approval, rejection, retry)
6. Rate engine (staleness, spread calculation)
7. API routes (auth gating, validation, error responses)
8. UI components (last priority)

## Build Phases

```
Wave 1 (weeks 1-12):  Web app + backend + all integrations
Wave 2a (weeks 10-20): iOS app (Swift)
Wave 2b (weeks 14-24): Android app (Kotlin)
```

## Security Requirements

- PII encrypted at rest (AES-256). Bank details encrypted separately.
- Transfer amount limits per transaction and per day
- Velocity checks (sudden increase in send frequency = flag)
- Device fingerprinting (basic at launch)
- IP geolocation (flag VPN/country mismatch)
- Every admin action logged with actor identity
- AUSTRAC threshold reporting and suspicious matter reporting

## Design Reference

Approved wireframe: `~/.gstack/projects/Kolaleaf/designs/send-screen-20260414/approved-wireframe.html`
Design doc: `~/.gstack/projects/Kolaleaf/ao-unknown-design-20260414-081002.md`
Visual direction: Purple-to-green gradient (premium fintech + Nigeria), white transfer card, trust indicators (AUSTRAC, speed, rating) above bottom nav.
