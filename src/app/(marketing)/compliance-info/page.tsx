import type { Metadata } from 'next'
import { colors } from '@/components/design/KolaPrimitives'

export const metadata: Metadata = {
  title: 'Compliance | Kolaleaf',
  description:
    'Kolaleaf compliance program — AUSTRAC registration, AML/CTF obligations, and fraud controls.',
}

// Placeholder compliance overview. Not legally authoritative. Final language
// lands after counsel review before public launch.
export default function CompliancePage() {
  return (
    <article
      className="mx-auto px-6 py-12"
      style={{ maxWidth: '720px', color: colors.ink }}
    >
      <LegalBanner />

      <h1
        className="mt-8"
        style={{ fontSize: '32px', fontWeight: 700, letterSpacing: '-0.5px', lineHeight: 1.15 }}
      >
        Compliance
      </h1>
      <p className="mt-2" style={{ fontSize: '13px', color: colors.muted }}>
        Last updated: placeholder date — pending legal review
      </p>

      <Section title="AUSTRAC registration">
        <p>
          Kolaleaf operates as a registered remittance service provider with
          the Australian Transaction Reports and Analysis Centre (AUSTRAC).
          Our registration number is{' '}
          <strong style={{ fontWeight: 600 }}>IND100512345</strong>{' '}
          (placeholder — final number pending legal review). You can verify
          any Australian remittance provider on the AUSTRAC public register.
        </p>
      </Section>

      <Section title="AML/CTF program">
        <p>
          We maintain a written Anti-Money Laundering and Counter-Terrorism
          Financing program tailored to our business. Core controls include:
        </p>
        <ul className="mt-3 list-disc pl-6 space-y-1">
          <li>Identity verification on every new account before funds can be sent</li>
          <li>Ongoing customer due diligence and risk rating</li>
          <li>Transaction monitoring with velocity and pattern checks</li>
          <li>Sanctions and politically-exposed-person (PEP) screening</li>
          <li>Mandatory staff training and an appointed AML/CTF compliance officer</li>
          <li>Independent program review on a regular cycle</li>
        </ul>
      </Section>

      <Section title="Reporting obligations">
        <p>
          Under the AML/CTF Act, we are required to submit threshold
          transaction reports, international funds transfer instructions, and
          suspicious matter reports to AUSTRAC. We do this without notifying
          the customer — it is unlawful to tip off a person that they are the
          subject of a suspicious matter report. We retain transaction records
          for seven years from the date of each transaction.
        </p>
      </Section>

      <Section title="How we protect against fraud">
        <p>
          Kolaleaf uses a layered fraud defence: device fingerprinting, IP
          geolocation, per-account and per-day send limits, velocity checks,
          webhook idempotency to avoid double payouts, daily reconciliation
          against our payment partners, and manual review queues for flagged
          activity. We will delay or decline transfers where we cannot satisfy
          our compliance requirements.
        </p>
      </Section>

      <Section title="Consumer protection">
        <p>
          Customer-fund handling, segregation, and trust-account
          arrangements are described in our final Terms of Service and
          supporting disclosures — treat any language on this page as
          illustrative pending legal review. At quote time we intend to
          disclose the FX rate and fees and lock them when you confirm.
          Where we cannot settle a transfer we intend to refund the
          originating funds to their source. Complaints will be handled
          internally first; unresolved complaints can be escalated to the
          Australian Financial Complaints Authority (AFCA).
        </p>
      </Section>

      <Section title="Contact our compliance team">
        <p>
          Compliance or regulatory enquiries:{' '}
          <a href="mailto:compliance@kolaleaf.com" style={{ color: colors.purple, textDecoration: 'underline' }}>
            compliance@kolaleaf.com
          </a>
          . For reports of suspected fraud against your account, contact{' '}
          <a href="mailto:support@kolaleaf.com" style={{ color: colors.purple, textDecoration: 'underline' }}>
            support@kolaleaf.com
          </a>{' '}
          immediately.
        </p>
      </Section>
    </article>
  )
}

function LegalBanner() {
  return (
    <div
      role="note"
      aria-label="Legal review pending"
      style={{
        background: '#fff7e0',
        border: `1px solid #f0c040`,
        borderRadius: '10px',
        padding: '14px 18px',
        fontSize: '13px',
        lineHeight: 1.5,
        color: colors.ink,
      }}
    >
      <strong style={{ fontWeight: 700 }}>Pending legal review.</strong>{' '}
      This page is a placeholder and not authoritative. For the current
      compliance position, contact{' '}
      <a href="mailto:compliance@kolaleaf.com" style={{ color: colors.purple, textDecoration: 'underline' }}>
        compliance@kolaleaf.com
      </a>
      .
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8" style={{ fontSize: '15px', lineHeight: 1.7 }}>
      <h2 style={{ fontSize: '20px', fontWeight: 700, color: colors.ink }}>{title}</h2>
      <div className="mt-3" style={{ color: colors.ink }}>
        {children}
      </div>
    </section>
  )
}
