// LockScreenCard.swift  (Phase 10A · U69)
// Full lock-screen / banner card. Layout (top → bottom):
//   1. Header row     · K mark + "Kolaleaf" + elapsed timestamp
//   2. Body row       · status icon + stage label  |  AUD → NGN amount column
//   3. Progress bar   · 5-segment, mirrors mini timeline
//
// Padding stays inside ActivityKit's safe content rect — the OS
// already adds its own outer padding around the card body.
//
// `now` is injected (default `Date()`) so the snapshot suite can pass a
// fixed clock and produce deterministic elapsed-badge output.
// ADV-P10A-C6.

import SwiftUI

struct LockScreenCard: View {
    let attributes: KolaleafTransferAttributes
    let state: KolaleafTransferAttributes.ContentState
    var now: Date = Date()

    var body: some View {
        let descriptor = LiveActivityStyle.descriptor(
            for: state.state,
            recipientName: attributes.recipientName
        )
        VStack(alignment: .leading, spacing: 10) {
            header(tint: descriptor.tint)
            body(descriptor: descriptor)
            LiveActivityProgressBar(state: state.state)
                .frame(height: 4)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel(headline: descriptor.headline))
    }

    // MARK: - Header

    @ViewBuilder
    private func header(tint: Color) -> some View {
        HStack(spacing: 6) {
            KolaMark(size: 18, tint: tint)
            Text(LiveActivityCopyLint.assertNotForbidden("Kolaleaf"))
                .font(.system(size: 13, weight: .bold))
                .foregroundColor(KolaColors.ink)
            Spacer(minLength: 0)
            Text(LiveActivityFormat.elapsed(since: state.lastUpdate, now: now))
                .font(.system(size: 11, weight: .semibold).monospacedDigit())
                .foregroundColor(KolaColors.muted)
        }
    }

    // MARK: - Body

    @ViewBuilder
    private func body(descriptor: LiveActivityDescriptor) -> some View {
        let tint = descriptor.tint
        HStack(alignment: .center, spacing: 12) {
            // Left: status icon + stage label
            HStack(alignment: .center, spacing: 8) {
                Image(systemName: descriptor.glyph)
                    .font(.system(size: 18, weight: .bold))
                    .foregroundColor(tint)
                    .frame(width: 26, height: 26)
                    .background(
                        Circle().fill(tint.opacity(0.12))
                    )
                VStack(alignment: .leading, spacing: 2) {
                    Text(LiveActivityCopyLint.assertNotForbidden(descriptor.headline))
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(KolaColors.ink)
                        .lineLimit(1)
                    Text(LiveActivityCopyLint.assertNotForbidden(
                        state.stageLabel.isEmpty ? attributes.recipientName : state.stageLabel
                    ))
                        .font(.system(size: 11, weight: .regular))
                        .foregroundColor(KolaColors.muted)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
            }
            Spacer(minLength: 0)
            // Right: amount column (AUD → NGN, with FX rate caption)
            VStack(alignment: .trailing, spacing: 2) {
                Text(attributes.audAmount)
                    .font(.system(size: 12, weight: .medium).monospacedDigit())
                    .foregroundColor(KolaColors.muted)
                Text(attributes.ngnAmount)
                    .font(.system(size: 14, weight: .bold).monospacedDigit())
                    .foregroundColor(tint)
                // ADV-P10A-W7: surface the exchangeRate that was
                // declared on the attributes but rendered nowhere.
                Text(attributes.exchangeRate)
                    .font(.system(size: 11, weight: .regular))
                    .foregroundColor(KolaColors.muted)
            }
        }
    }

    // MARK: - Accessibility

    private func accessibilityLabel(headline: String) -> String {
        let eta = LiveActivityFormat.etaCopy(state: state.state, etaSeconds: state.etaSeconds)
        let amount = LiveActivityAccessibility.amountLabel(
            aud: attributes.audAmount,
            ngn: attributes.ngnAmount
        )
        return "\(headline). \(amount). \(eta) remaining."
    }
}

struct LockScreenCardPrivacyGate: View {
    let attributes: KolaleafTransferAttributes
    let state: KolaleafTransferAttributes.ContentState
    var now: Date = Date()

    @Environment(\.redactionReasons) private var redactionReasons
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced

    var body: some View {
        if LockScreenPrivacy.shouldRedact(
            redactionReasons: redactionReasons,
            isLuminanceReduced: isLuminanceReduced
        ) {
            LockScreenCardRedacted(attributes: attributes, state: state, now: now)
        } else {
            LockScreenCard(attributes: attributes, state: state, now: now)
        }
    }
}

enum LockScreenPrivacy {
    static func shouldRedact(
        redactionReasons: RedactionReasons,
        isLuminanceReduced: Bool
    ) -> Bool {
        isLuminanceReduced || !redactionReasons.isEmpty
    }
}

struct LockScreenCardRedacted: View {
    let attributes: KolaleafTransferAttributes
    let state: KolaleafTransferAttributes.ContentState
    var now: Date = Date()

    var body: some View {
        let descriptor = LiveActivityStyle.descriptor(
            for: state.state,
            recipientName: ""
        )
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                KolaMark(size: 18, tint: descriptor.tint)
                Text(LiveActivityCopyLint.assertNotForbidden("Kolaleaf"))
                    .font(.system(size: 13, weight: .bold))
                    .foregroundColor(KolaColors.ink)
                Spacer(minLength: 0)
                Text(LiveActivityFormat.elapsed(since: state.lastUpdate, now: now))
                    .font(.system(size: 11, weight: .semibold).monospacedDigit())
                    .foregroundColor(KolaColors.muted)
            }

            HStack(alignment: .center, spacing: 8) {
                Image(systemName: descriptor.glyph)
                    .font(.system(size: 18, weight: .bold))
                    .foregroundColor(descriptor.tint)
                    .frame(width: 26, height: 26)
                    .background(Circle().fill(descriptor.tint.opacity(0.12)))
                VStack(alignment: .leading, spacing: 2) {
                    Text(LiveActivityCopyLint.assertNotForbidden(
                        LockScreenRedactedCopy.headline(for: state.state)
                    ))
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(KolaColors.ink)
                    .lineLimit(1)
                    Text(redactedDetail)
                        .font(.system(size: 11, weight: .regular))
                        .foregroundColor(KolaColors.muted)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                Image(systemName: "lock.shield.fill")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundColor(KolaColors.muted)
            }

            LiveActivityProgressBar(state: state.state)
                .frame(height: 4)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(LockScreenRedactedCopy.accessibilityLabel(
            state: state.state,
            etaSeconds: state.etaSeconds
        ))
    }

    private var redactedDetail: String {
        LockScreenRedactedCopy.detail(state: state.state, etaSeconds: state.etaSeconds)
    }
}

enum LockScreenRedactedCopy {
    static func headline(for state: LiveActivityState) -> String {
        switch state {
        case .awaitingAUD:
            return "Awaiting your AUD"
        case .processingNGN:
            return "Transfer in progress"
        case .completed:
            return "Transfer completed"
        case .floatPaused:
            return "Catching up — almost there"
        case .failedRetry:
            return "Retrying transfer"
        case .needsAction:
            return "Action needed — open app"
        case .unknown:
            return "Updating"
        }
    }

    static func accessibilityLabel(state: LiveActivityState, etaSeconds: Int) -> String {
        "Kolaleaf transfer update. \(headline(for: state)). \(detail(state: state, etaSeconds: etaSeconds))."
    }

    static func detail(state: LiveActivityState, etaSeconds: Int) -> String {
        let eta = LiveActivityFormat.etaCopy(state: state, etaSeconds: etaSeconds)
        return eta == "—" ? "Open Kolaleaf for details" : "\(eta) remaining"
    }
}
