// ExpiredTransferView.swift  (Phase 9 · U63 + iter-3 F5/F8)
// Screen 40 — the 24h AWAITING_AUD window has lapsed. Shows what
// was attempted, today's rate vs. the locked rate, and offers a
// re-quote CTA that pre-fills SendView with the same recipient at
// today's price.
//
// iter-3 changes:
//   • F5 / ADV-P9-W5: rate-movement disclosure is now banded.
//     Silent <1%, "slightly lower" 1-3%, explicit "X% lower" 3-10%,
//     hard warning >10%. We also surface the projected NGN total at
//     today's rate before the re-quote CTA so the user sees what
//     they'll receive without leaving the screen.
//   • F8 / OO-905: AUD + rate decimals routed through
//     `KolaFormatters` — no more inline private helpers.

import SwiftUI

public struct ExpiredTransferView: View {

    @State private var vm: ExpiredTransferViewModel
    /// Fired when the user taps "Send at today's rate". Caller (SendTabRoot)
    /// pushes a SendView seeded with the prefill.
    private let onRequote: (SendPrefill) -> Void
    /// Fired when the user taps "Done". Pops back to the Send root.
    private let onDone: () -> Void

    public init(
        api: AuthAPI,
        expiredTransfer: Transfer,
        recipient: Recipient,
        onRequote: @escaping (SendPrefill) -> Void,
        onDone: @escaping () -> Void
    ) {
        _vm = State(initialValue: ExpiredTransferViewModel(
            api: api,
            expiredTransfer: expiredTransfer,
            recipient: recipient
        ))
        self.onRequote = onRequote
        self.onDone = onDone
    }

    public var body: some View {
        ScrollView {
            VStack(spacing: KolaSpacing.card) {
                header
                attemptCard
                rateCard
                ctaStack
            }
            .padding(.horizontal, KolaSpacing.xl)
            .padding(.top, KolaSpacing.xxl)
            .padding(.bottom, KolaSpacing.homeIndicator)
        }
        .background(KolaColors.surface.ignoresSafeArea())
        .task { await vm.loadTodaysRate() }
    }

    // MARK: - Subviews

    private var header: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            Text("This transfer expired")
                .font(KolaFont.pageTitle)
                .kerning(KolaKerning.headline)
                .foregroundStyle(KolaColors.textPrimary)
            Text("Your locked rate expired after 24 hours.")
                .font(KolaFont.tagline)
                .foregroundStyle(KolaColors.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var attemptCard: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            Text("Attempted")
                .font(KolaFont.fieldLabel)
                .kerning(KolaKerning.label)
                .textCase(.uppercase)
                .foregroundStyle(KolaColors.textSecondary)
            Text("AU$\(KolaFormatters.audDisplay(vm.sendAmount)) to \(vm.recipientName)")
                .font(KolaFont.rowTotal)
                .foregroundStyle(KolaColors.textPrimary)
            Text("Locked rate: 1 AUD = \(KolaFormatters.rateDisplay(vm.lockedRate)) NGN")
                .font(KolaFont.timestamp)
                .foregroundStyle(KolaColors.textSecondary)
        }
        .padding(KolaSpacing.card)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: KolaRadius.cardLg, style: .continuous)
                .fill(Color.white)
        )
        .overlay(
            RoundedRectangle(cornerRadius: KolaRadius.cardLg, style: .continuous)
                .strokeBorder(KolaColors.border, lineWidth: 1)
        )
    }

    @ViewBuilder
    private var rateCard: some View {
        switch vm.loadState {
        case .loading:
            HStack(spacing: KolaSpacing.s) {
                ProgressView()
                    .progressViewStyle(.circular)
                    .tint(KolaColors.trustGreen)
                Text("Checking today's rate…")
                    .font(KolaFont.tagline)
                    .foregroundStyle(KolaColors.textSecondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        case .loaded:
            if let today = vm.todaysRate {
                loadedRateCard(today: today)
            }
        case .error(let message):
            KolaErrorCard(
                tint: KolaColors.coral,
                iconSystemName: "exclamationmark.triangle.fill",
                title: "Couldn't load today's rate",
                message: message,
                retry: KolaErrorCard.RetryAction(
                    label: "Try again",
                    hint: "Reloads today's exchange rate",
                    perform: { Task { await vm.loadTodaysRate() } }
                )
            )
        }
    }

    @ViewBuilder
    private func loadedRateCard(today: Decimal) -> some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            Text("Today's rate")
                .font(KolaFont.fieldLabel)
                .kerning(KolaKerning.label)
                .textCase(.uppercase)
                .foregroundStyle(KolaColors.textSecondary)
            Text("1 AUD = \(KolaFormatters.rateDisplay(today)) NGN")
                .font(KolaFont.rowTotal)
                .foregroundStyle(KolaColors.textPrimary)
            if let total = vm.todaysTotalNgn {
                // F5: surface the projected NGN total at today's rate
                // before the user commits to a re-quote tap.
                Text("You'll receive ~\(KolaFormatters.rateDisplay(total)) NGN")
                    .font(KolaFont.timestamp)
                    .foregroundStyle(KolaColors.textSecondary)
            }
            rateMovementBand
        }
        .padding(KolaSpacing.card)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: KolaRadius.cardLg, style: .continuous)
                .fill(Color.white)
        )
        .overlay(
            RoundedRectangle(cornerRadius: KolaRadius.cardLg, style: .continuous)
                .strokeBorder(KolaColors.border, lineWidth: 1)
        )
    }

    /// F5 / ADV-P9-W5: banded disclosure of rate movement.
    /// Silent (no card)        — delta nil, positive (better), or |Δ| < 1%
    /// "slightly lower"        — 1% ≤ Δ < 3%
    /// "X% lower than locked"  — 3% ≤ Δ ≤ 10%
    /// "X% lower" hard warning — Δ > 10% (red border, secondary line
    ///                           explaining the re-quote impact)
    @ViewBuilder
    private var rateMovementBand: some View {
        switch movementBand {
        case .silent:
            EmptyView()
        case .slight:
            Text("Today's rate is lower than your locked rate.")
                .font(KolaFont.timestamp)
                .foregroundStyle(KolaColors.textSecondary)
        case .moderate(let pct):
            Text("Today's rate is \(pct)% lower than your locked rate.")
                .font(KolaFont.timestamp)
                .foregroundStyle(KolaColors.textSecondary)
        case .severe(let pct):
            VStack(alignment: .leading, spacing: KolaSpacing.xs) {
                Text("Today's rate is \(pct)% lower")
                    .font(KolaFont.cta)
                    .foregroundStyle(KolaColors.coral)
                Text("You'll receive less Naira than your original quote showed.")
                    .font(KolaFont.tagline)
                    .foregroundStyle(KolaColors.textSecondary)
            }
            .padding(KolaSpacing.s)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: KolaRadius.chip, style: .continuous)
                    .fill(KolaColors.coral.opacity(0.06))
            )
            .overlay(
                RoundedRectangle(cornerRadius: KolaRadius.chip, style: .continuous)
                    .strokeBorder(KolaColors.coral, lineWidth: 1)
            )
        }
    }

    private enum MovementBand: Equatable {
        case silent
        case slight
        case moderate(Int)
        case severe(Int)
    }

    /// Translates the VM's signed delta into a UI band. Negative delta
    /// = today's rate is below the locked rate (worse for the sender);
    /// we only band the negative side because positive movement is a
    /// non-event for disclosure.
    private var movementBand: MovementBand {
        guard let delta = vm.rateMovementDeltaPercent else { return .silent }
        let neg = -delta  // flip so "lower today" reads as positive %
        if neg < 1 { return .silent }
        if neg < 3 { return .slight }
        // Round half-up to the nearest integer for display.
        var rounded = Decimal()
        var src = neg
        NSDecimalRound(&rounded, &src, 0, .plain)
        let pct = (NSDecimalNumber(decimal: rounded).intValue)
        if neg <= 10 { return .moderate(pct) }
        return .severe(pct)
    }

    private var ctaStack: some View {
        VStack(spacing: KolaSpacing.m) {
            Button(action: { onRequote(vm.makePrefill()) }) {
                Text("Send at today's rate")
                    .font(KolaFont.cta)
                    .kerning(KolaKerning.cta)
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: KolaSpacing.hitTarget + 6)
                    .background(
                        RoundedRectangle(cornerRadius: KolaRadius.cta, style: .continuous)
                            .fill(KolaColors.kolaGreen)
                    )
            }
            .buttonStyle(.plain)
            .disabled(vm.loadState != .loaded)

            Button(action: onDone) {
                Text("Done")
                    .font(KolaFont.cta)
                    .foregroundStyle(KolaColors.trustGreen)
                    .frame(maxWidth: .infinity, minHeight: KolaSpacing.hitTarget)
            }
            .buttonStyle(.plain)
        }
    }
}
