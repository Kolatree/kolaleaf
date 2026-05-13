// PayIDInstructionsView.swift  (Phase 6 · U48)
// Screen rendered after a transfer has been created. Issues the
// PayID, shows it to the user, and offers Copy + Open-bank affordances.
//
// The "Open my bank" CTA opens the share sheet rather than a deep-link
// allow-list — bank deep-link schemes vary by issuer and are not all
// publicly documented. A share sheet gives the user a one-tap route
// to copy/share the PayID into any banking app they have.

import SwiftUI
import UIKit

public struct PayIDInstructionsView: View {

    @State private var vm: PayIDInstructionsViewModel
    @State private var showCopied: Bool = false
    @State private var copyAckCounter: UInt = 0
    @State private var now: Date = Date()
    private let onContinue: () -> Void
    /// Phase 9 · U62: optional cancel-transfer escape hatch. Wired by
    /// SendTabRoot to push the CancelTransferView destination. Defaults
    /// to nil so existing callers (and snapshot tests) keep compiling.
    private let onCancelRequested: (() -> Void)?

    public init(
        api: AuthAPI,
        transferId: String,
        onContinue: @escaping () -> Void,
        onCancelRequested: (() -> Void)? = nil
    ) {
        _vm = State(initialValue: PayIDInstructionsViewModel(api: api, transferId: transferId))
        self.onContinue = onContinue
        self.onCancelRequested = onCancelRequested
    }

    public var body: some View {
        ScrollView {
            VStack(spacing: KolaSpacing.card) {
                header
                payIdCard
                countdownLine
                instructions
                ctaStack
            }
            .padding(.horizontal, KolaSpacing.xl)
            .padding(.top, KolaSpacing.xxl)
            .padding(.bottom, KolaSpacing.homeIndicator)
        }
        .background(KolaColors.surface.ignoresSafeArea())
        .task { await vm.issuePayID() }
        .navigationBarBackButtonHidden(true)
        .toolbar { ToolbarItem(placement: .topBarLeading) { EmptyView() } }
        .onReceive(Timer.publish(every: 60, on: .main, in: .common).autoconnect()) { date in
            now = date
        }
        // Iter-2 (S5 / CA-007): structured-concurrency-friendly
        // auto-revert. Driven by `copyAckCounter` so successive copies
        // each get their own 2-second window without leaking task
        // continuations.
        .task(id: copyAckCounter) {
            guard showCopied else { return }
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            if !Task.isCancelled {
                showCopied = false
            }
        }
    }

    // MARK: - Subviews

    private var header: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            Text("Push your AUD")
                .font(KolaFont.pageTitle)
                .kerning(KolaKerning.headline)
                .foregroundStyle(KolaColors.textPrimary)
            Text("Open your bank's app and send to this PayID. We'll handle the rest once funds arrive.")
                .font(KolaFont.tagline)
                .foregroundStyle(KolaColors.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var payIdCard: some View {
        switch vm.state {
        case .idle, .loading:
            loadingCard
        case .loaded(let payId, let reference, _):
            loadedCard(payId: payId, reference: reference)
        case .kycBlocked:
            kycBlockedCard
        case .failed(let message):
            failedCard(message: message)
        }
    }

    private var loadingCard: some View {
        VStack(spacing: KolaSpacing.m) {
            ProgressView()
                .progressViewStyle(.circular)
                .tint(KolaColors.trustGreen)
            Text("Generating your PayID…")
                .font(KolaFont.tagline)
                .foregroundStyle(KolaColors.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(KolaSpacing.card)
        .background(
            RoundedRectangle(cornerRadius: KolaRadius.cardLg, style: .continuous)
                .fill(Color.white)
        )
        .overlay(
            RoundedRectangle(cornerRadius: KolaRadius.cardLg, style: .continuous)
                .strokeBorder(KolaColors.border, lineWidth: 1)
        )
    }

    private func loadedCard(payId: String, reference: String) -> some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            Text("Your PayID")
                .font(KolaFont.fieldLabel)
                .kerning(KolaKerning.label)
                .textCase(.uppercase)
                .foregroundStyle(KolaColors.textSecondary)
            // PayID strings can be long — allow wrapping and avoid
            // truncation. monospacedDigit keeps the visual aligned
            // when long references show up.
            Text(payId)
                .font(KolaFont.rowTotal)
                .foregroundStyle(KolaColors.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
                .accessibilityIdentifier("payid.value")
            if !reference.isEmpty {
                Text("Reference: \(reference)")
                    .font(KolaFont.timestamp)
                    .foregroundStyle(KolaColors.textSecondary)
            }
            HStack(spacing: KolaSpacing.s) {
                Button(action: { copyPayId(payId) }) {
                    Label(showCopied ? "Copied" : "Copy", systemImage: showCopied ? "checkmark" : "doc.on.doc")
                        .font(KolaFont.cta)
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, minHeight: KolaSpacing.hitTarget)
                        .background(
                            RoundedRectangle(cornerRadius: KolaRadius.cta, style: .continuous)
                                .fill(KolaColors.trustGreen)
                        )
                }
                .buttonStyle(.plain)
                .accessibilityLabel(showCopied ? "PayID copied" : "Copy PayID")

                ShareLink(item: payId) {
                    Label("Share", systemImage: "square.and.arrow.up")
                        .font(KolaFont.cta)
                        .foregroundStyle(KolaColors.trustGreen)
                        .frame(maxWidth: .infinity, minHeight: KolaSpacing.hitTarget)
                        .background(
                            RoundedRectangle(cornerRadius: KolaRadius.cta, style: .continuous)
                                .strokeBorder(KolaColors.trustGreen, lineWidth: 1)
                        )
                }
                .accessibilityLabel("Share PayID")
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

    private var kycBlockedCard: some View {
        KolaErrorCard(
            tint: KolaColors.warning,
            iconSystemName: "exclamationmark.shield.fill",
            title: "Identity verification required",
            message: "We need to verify your identity before issuing a PayID.",
            retry: nil
        )
    }

    private func failedCard(message: String) -> some View {
        KolaErrorCard(
            tint: KolaColors.coral,
            iconSystemName: "exclamationmark.triangle.fill",
            title: "Couldn't issue PayID",
            message: message,
            retry: KolaErrorCard.RetryAction(
                label: "Try again",
                hint: "Retries the PayID issuance",
                perform: { Task { await vm.issuePayID() } }
            )
        )
    }

    @ViewBuilder
    private var countdownLine: some View {
        if let remaining = vm.remainingUntilExpiry(now: now) {
            HStack(spacing: KolaSpacing.xs) {
                Image(systemName: "clock")
                    .font(.system(size: 12, weight: .semibold))
                Text("Push within \(Self.formatRemaining(remaining))")
                    .font(KolaFont.timestamp)
            }
            .foregroundStyle(KolaColors.textSecondary)
        }
    }

    private var instructions: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            instructionStep(number: "1", text: "Open your bank's app and pick PayID transfer.")
            instructionStep(number: "2", text: "Paste this PayID as the recipient.")
            instructionStep(number: "3", text: "Send the amount you entered.")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func instructionStep(number: String, text: String) -> some View {
        HStack(alignment: .top, spacing: KolaSpacing.s) {
            Text(number)
                .font(KolaFont.rowTotal)
                .foregroundStyle(.white)
                .frame(width: 22, height: 22)
                .background(Circle().fill(KolaColors.trustGreen))
            Text(text)
                .font(KolaFont.row)
                .foregroundStyle(KolaColors.textPrimary)
        }
    }

    private var ctaStack: some View {
        VStack(spacing: KolaSpacing.m) {
            Button(action: onContinue) {
                Text("Track this transfer")
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

            // Phase 9 · U62: user-initiated cancel hatch. Hidden when
            // the parent didn't wire a handler (defensive — keeps the
            // surface intact for existing snapshot tests).
            if let onCancelRequested {
                Button(action: onCancelRequested) {
                    Text("Cancel transfer")
                        .font(KolaFont.cta)
                        .foregroundStyle(KolaColors.coral)
                        .frame(maxWidth: .infinity, minHeight: KolaSpacing.hitTarget)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("payid.cancel")
            }
        }
    }

    // MARK: - Helpers

    private func copyPayId(_ payId: String) {
        // Iter-2 (W19 / ADV-P6-W2): clipboard entry expires after 2
        // minutes so the PayID handle doesn't linger on the clipboard
        // and get pasted into an unrelated app.
        UIPasteboard.general.setItems(
            [[UIPasteboard.typeAutomatic: payId]],
            options: [
                .expirationDate: Date().addingTimeInterval(120),
                .localOnly: true,
            ]
        )
        showCopied = true
        // The `.task(id: copyAckCounter)` modifier on body drives the
        // auto-revert (S5 / CA-007). Bump the counter so a fresh
        // 2-second window starts.
        copyAckCounter &+= 1
    }

    private static func formatRemaining(_ seconds: TimeInterval) -> String {
        let hours = Int(seconds) / 3600
        let minutes = (Int(seconds) % 3600) / 60
        if hours > 0 {
            return "\(hours)h \(minutes)m"
        }
        return "\(minutes)m"
    }
}
