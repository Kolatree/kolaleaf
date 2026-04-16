import type { Metadata } from 'next'
import { colors } from '@/components/design/KolaPrimitives'

export const metadata: Metadata = {
  title: 'Terms | Kolaleaf',
  description:
    'Terms of service for using Kolaleaf, an AUSTRAC-registered AUD-to-NGN remittance service.',
}

// Placeholder terms of service. Not legally binding. Final copy lands after
// counsel review before public launch.
export default function TermsPage() {
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
        Terms of Service
      </h1>
      <p className="mt-2" style={{ fontSize: '13px', color: colors.muted }}>
        Last updated: placeholder date — pending legal review
      </p>

      <Section title="Account eligibility">
        <p>
          You must be at least 18 years old and resident in Australia to open
          a Kolaleaf account. You must complete identity verification (KYC)
          before you can send a transfer. We may decline to open or may close
          an account at our discretion where required to meet our legal and
          regulatory obligations.
        </p>
      </Section>

      <Section title="Your responsibilities">
        <p>
          You agree to provide accurate information about yourself, the
          purpose of each transfer, and the recipient. You agree to keep your
          account credentials secure, to enable two-factor authentication, and
          to notify us promptly if you suspect unauthorised access. You are
          responsible for confirming recipient bank details before
          authorising a transfer — once funds are sent to the recipient, we
          cannot always recall them.
        </p>
      </Section>

      <Section title="Our responsibilities">
        <p>
          We operate as an AUSTRAC-registered remittance service. We will
          handle your transfer within the stated service windows, apply the FX
          rate and fees disclosed at quote time, and notify you of material
          state changes in your transfer. Where a transfer fails at the payout
          stage, we will retry per our payout policy or refund the originating
          funds if no successful settlement is possible.
        </p>
      </Section>

      <Section title="Prohibited uses">
        <p>You agree not to use Kolaleaf to:</p>
        <ul className="mt-3 list-disc pl-6 space-y-1">
          <li>Transfer funds derived from or destined for unlawful activity</li>
          <li>Evade sanctions, reporting thresholds, or AML/CTF obligations</li>
          <li>Impersonate another person or submit false identity documents</li>
          <li>Send funds to jurisdictions we do not service</li>
          <li>Use the service for gambling-related settlement without disclosure</li>
        </ul>
      </Section>

      <Section title="Limitation of liability">
        <p>
          To the extent permitted by Australian law, Kolaleaf is not liable
          for indirect or consequential loss, including lost profits, loss of
          opportunity, or third-party bank delays outside our control. Nothing
          in these terms limits any non-excludable consumer guarantee under
          the Australian Consumer Law.
        </p>
      </Section>

      <Section title="Governing law">
        <p>
          These terms are governed by the laws of the state of New South
          Wales, Australia. Disputes are subject to the exclusive jurisdiction
          of the courts of that state. Final jurisdiction and venue are
          placeholder and subject to counsel review.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions about these terms?{' '}
          <a href="mailto:legal@kolaleaf.com" style={{ color: colors.purple, textDecoration: 'underline' }}>
            legal@kolaleaf.com
          </a>
          .
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
      This page is a placeholder. It is not legally binding. Contact{' '}
      <a href="mailto:support@kolaleaf.com" style={{ color: colors.purple, textDecoration: 'underline' }}>
        support@kolaleaf.com
      </a>{' '}
      for the authoritative version.
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
