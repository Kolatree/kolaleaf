// ExpiredTransferView.swift  (Phase 9 · U63)
// Screen 40 — the 24h AWAITING_AUD window has lapsed. Shows what
// was attempted, today's rate vs. the locked rate, and offers a
// re-quote CTA that pre-fills SendView with the same recipient at
// today's price.
//
// The "rate moved against you" hint is informational (not alarmist):
// the locked rate is gone regardless, so we tell the user the
// direction without over-emphasising it.

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
            Text("We didn't receive your AUD within 24 hours, so we let the rate go.")
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
            Text("AU$\(Self.formatAud(vm.sendAmount)) to \(vm.recipientName)")
                .font(KolaFont.rowTotal)
                .foregroundStyle(KolaColors.textPrimary)
            Text("Locked rate: 1 AUD = \(Self.formatRate(vm.lockedRate)) NGN")
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
                VStack(alignment: .leading, spacing: KolaSpacing.s) {
                    Text("Today's rate")
                        .font(KolaFont.fieldLabel)
                        .kerning(KolaKerning.label)
                        .textCase(.uppercase)
                        .foregroundStyle(KolaColors.textSecondary)
                    Text("1 AUD = \(Self.formatRate(today)) NGN")
                        .font(KolaFont.rowTotal)
                        .foregroundStyle(KolaColors.textPrimary)
                    if vm.rateMovedAgainstUser {
                        Text("Slightly lower than your locked rate.")
                            .font(KolaFont.timestamp)
                            .foregroundStyle(KolaColors.textSecondary)
                    }
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

    // MARK: - Formatting

    private static func formatAud(_ d: Decimal) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.maximumFractionDigits = 2
        f.minimumFractionDigits = 2
        f.locale = Locale(identifier: "en_AU")
        return f.string(from: NSDecimalNumber(decimal: d)) ?? "\(d)"
    }

    private static func formatRate(_ d: Decimal) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.maximumFractionDigits = 2
        f.minimumFractionDigits = 2
        f.locale = Locale(identifier: "en_AU")
        return f.string(from: NSDecimalNumber(decimal: d)) ?? "\(d)"
    }
}
