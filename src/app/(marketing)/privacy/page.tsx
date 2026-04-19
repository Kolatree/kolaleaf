import type { Metadata } from 'next'
import { colors } from '@/components/design/KolaPrimitives'

export const metadata: Metadata = {
  title: 'Privacy | Kolaleaf',
  description:
    'How Kolaleaf collects, stores, and protects your personal information while moving money between Australia and Nigeria.',
}

// Placeholder privacy policy. Legal copy is NOT authoritative — final text
// lands after counsel review before public launch.
export default function PrivacyPage() {
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
        Privacy Policy
      </h1>
      <p className="mt-2" style={{ fontSize: '13px', color: colors.muted }}>
        Last updated: placeholder date — pending legal review
      </p>

      <Section title="What we collect">
        <p>
          To send money from Australia to Nigeria through a licensed remittance
          service, we collect the information required to verify who you are,
          meet our AUSTRAC obligations, and settle your transfer. This includes
          your name, date of birth, residential address, contact details,
          government identification, recipient bank details, and the amount and
          purpose of each transfer.
        </p>
      </Section>

      <Section title="Why we collect it">
        <p>
          We collect personal information to confirm your identity, comply with
          Australian anti-money-laundering and counter-terrorism-financing
          (AML/CTF) law, prevent fraud, process your transfers, and send you
          service updates about transfers you have initiated.
        </p>
      </Section>

      <Section title="How we store it">
        <p>
          Personal and financial data is encrypted at rest and in transit.
          Access is limited to staff who need it for their role. We retain
          transaction records for seven years from the date of the transaction,
          as required under the AML/CTF Act. Where possible we minimise what we
          hold and purge data that is no longer required.
        </p>
      </Section>

      <Section title="Who we share it with">
        <p>We share information only with vendors essential to running the service:</p>
        <ul className="mt-3 list-disc pl-6 space-y-1">
          <li>Sumsub — identity verification (KYC)</li>
          <li>Monoova — inbound AUD collection via PayID</li>
          <li>BudPay and Flutterwave — NGN payout to recipient banks</li>
          <li>Resend — transactional email notifications</li>
          <li>Twilio — SMS notifications and 2FA codes</li>
        </ul>
        <p className="mt-3">
          We may also disclose information to law enforcement, AUSTRAC, or the
          courts where we are legally required to do so. We do not sell your
          information and we do not share it for marketing purposes.
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          You can request access to the personal information we hold about you,
          ask us to correct it, or raise a privacy concern. Some information we
          are legally required to retain for AML/CTF compliance and cannot
          delete on request. We will respond to privacy requests within a
          reasonable time.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          For privacy questions or requests, email{' '}
          <a href="mailto:privacy@kolaleaf.com" style={{ color: colors.purple, textDecoration: 'underline' }}>
            privacy@kolaleaf.com
          </a>
          . For urgent matters relating to a transfer, contact{' '}
          <a href="mailto:support@kolaleaf.com" style={{ color: colors.purple, textDecoration: 'underline' }}>
            support@kolaleaf.com
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
