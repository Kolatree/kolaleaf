// FloatPausedView.swift  (Phase 9 · U64)
// Screen 41 — the transfer pauses while we top up the rail. Amber
// holding banner, restated recipient + AUD amount, ETA countdown.
//
// PRIVACY INVARIANT (do not regress): user-visible copy is
// operational only. Forbidden words: "float", "treasury",
// "liquidity", "insufficient", "balance".
//
// Polling lives in `FloatPausedViewModel` (mirrors
// `ProcessingTimelineViewModel`). The view starts/stops polling on
// appear/disappear and runs a 1-second `Timer.publish` to drive the
// countdown. When the polled status leaves `.floatInsufficient` the
// VM fires `onResume(status)` and the parent re-routes via the
// SendCoordinator.

import SwiftUI

public struct FloatPausedView: View {

    @State private var vm: FloatPausedViewModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    private let recipientName: String
    private let audAmount: Decimal
    /// Local pulse driver for the amber dot. Skipped under
    /// `accessibilityReduceMotion`.
    @State private var pulse: Bool = false

    /// Fired when the polled status leaves `.floatInsufficient`.
    /// Caller composes a Domain Transfer + Recipient and routes via
    /// the SendCoordinator (happy or sad path depending on the new
    /// status).
    public init(
        api: AuthAPI,
        transferId: String,
        recipientName: String,
        audAmount: Decimal,
        etaSeconds: TimeInterval = 240,
        onResume: @escaping (TransferStatus) -> Void
    ) {
        _vm = State(initialValue: FloatPausedViewModel(
            api: api,
            transferId: transferId,
            etaSeconds: etaSeconds,
            onResume: onResume
        ))
        self.recipientName = recipientName
        self.audAmount = audAmount
    }

    public var body: some View {
        VStack(spacing: KolaSpacing.card) {
            holdingBanner
            recipientRestatement
            countdownBlock
            Spacer()
        }
        .padding(.horizontal, KolaSpacing.xl)
        .padding(.top, KolaSpacing.xxl)
        .padding(.bottom, KolaSpacing.homeIndicator)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(KolaColors.surface.ignoresSafeArea())
        .task { vm.start() }
        .onDisappear { vm.stop() }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                vm.start()
            case .background, .inactive:
                vm.stop()
            @unknown default:
                vm.stop()
            }
        }
        .onReceive(Timer.publish(every: 1, on: .main, in: .common).autoconnect()) { _ in
            vm.tick()
        }
        .onAppear {
            // Kick the pulse animation only when motion is allowed.
            // Reduce-motion users see a fully-coloured dot, just static.
            if !reduceMotion {
                pulse = true
            }
        }
    }

    // MARK: - Subviews

    private var holdingBanner: some View {
        HStack(spacing: KolaSpacing.s) {
            pulseDot
            VStack(alignment: .leading, spacing: 2) {
                Text("We're holding briefly while we top up.")
                    .font(KolaFont.rowValue)
                    .foregroundStyle(KolaColors.textPrimary)
                Text("Your transfer will continue automatically.")
                    .font(KolaFont.tagline)
                    .foregroundStyle(KolaColors.textSecondary)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, KolaSpacing.l)
        .padding(.vertical, KolaSpacing.m)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: KolaRadius.card, style: .continuous)
                .fill(KolaColors.warning.opacity(0.12))
        )
        .overlay(
            RoundedRectangle(cornerRadius: KolaRadius.card, style: .continuous)
                .strokeBorder(KolaColors.warning.opacity(0.30), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }

    private var pulseDot: some View {
        // Reduce-motion: static dot. Motion: opacity pulse driven by
        // a local @State bool flipped on appear.
        Circle()
            .fill(KolaColors.warning)
            .frame(width: 10, height: 10)
            .opacity(reduceMotion ? 1.0 : (pulse ? 1.0 : 0.4))
            .animation(
                reduceMotion ? .linear(duration: 0.001)
                             : .easeInOut(duration: 0.9).repeatForever(autoreverses: true),
                value: pulse
            )
            .accessibilityHidden(true)
    }

    private var recipientRestatement: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            Text("Your transfer")
                .font(KolaFont.fieldLabel)
                .kerning(KolaKerning.label)
                .textCase(.uppercase)
                .foregroundStyle(KolaColors.textSecondary)
            Text("AU$\(Self.formatAud(audAmount)) to \(recipientName)")
                .font(KolaFont.rowTotal)
                .foregroundStyle(KolaColors.textPrimary)
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
    private var countdownBlock: some View {
        if vm.remainingSeconds > 0 {
            VStack(spacing: KolaSpacing.xs) {
                Text(Self.formatCountdown(vm.remainingSeconds))
                    .font(KolaFont.amountMedium)
                    .foregroundStyle(KolaColors.textPrimary)
                Text("Estimated time to resume")
                    .font(KolaFont.tagline)
                    .foregroundStyle(KolaColors.textSecondary)
            }
            .frame(maxWidth: .infinity)
        } else {
            VStack(spacing: KolaSpacing.xs) {
                Text("Still holding")
                    .font(KolaFont.section)
                    .foregroundStyle(KolaColors.textPrimary)
                Text("We'll text you when it's moving.")
                    .font(KolaFont.tagline)
                    .foregroundStyle(KolaColors.textSecondary)
            }
            .frame(maxWidth: .infinity)
        }
    }

    // MARK: - Formatting

    private static func formatCountdown(_ seconds: Int) -> String {
        let m = seconds / 60
        let s = seconds % 60
        return String(format: "%d:%02d", m, s)
    }

    private static func formatAud(_ d: Decimal) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.maximumFractionDigits = 2
        f.minimumFractionDigits = 2
        f.locale = Locale(identifier: "en_AU")
        return f.string(from: NSDecimalNumber(decimal: d)) ?? "\(d)"
    }
}
