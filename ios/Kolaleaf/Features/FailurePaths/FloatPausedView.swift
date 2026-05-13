// FloatPausedView.swift  (Phase 9 · U64 + iter-3 F3/F8/F9/F13/F14)
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
//
// iter-3 changes:
//   • F3 / ADV-P9-W7: scene-phase `.active` now also calls
//     `vm.resync()` so a backgrounded app re-foregrounding shows the
//     correct (smaller) remaining-seconds value, not the paused-at
//     number.
//   • F8 / OO-905: countdown / AUD formatting routed through
//     `KolaFormatters`; the duplicated private helpers are gone.
//   • F9 / API-906: default ETA flows from
//     `FloatPausedViewModel.defaultRailResumeETASeconds`.
//   • F13 / OO-903: lifecycle (task / disappear / scene-phase /
//     timer / pulse-on-appear) factored into `FloatPausedLifecycle`
//     so the body keeps just visual content.
//   • F14 / ADV-P9-S1: pulse dot now uses iOS-17 `.symbolEffect`
//     (we're on iOS 17.2+; project.yml line 9). Reduce-motion users
//     still get a static dot.

import SwiftUI

public struct FloatPausedView: View {

    @State private var vm: FloatPausedViewModel

    private let recipientName: String
    private let audAmount: Decimal

    public init(
        api: AuthAPI,
        transferId: String,
        recipientName: String,
        audAmount: Decimal,
        etaSeconds: TimeInterval = FloatPausedViewModel.defaultRailResumeETASeconds,
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
        .modifier(FloatPausedLifecycle(vm: vm))
    }

    // MARK: - Subviews

    private var holdingBanner: some View {
        HStack(spacing: KolaSpacing.s) {
            PulseDot()
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

    private var recipientRestatement: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            Text("Your transfer")
                .font(KolaFont.fieldLabel)
                .kerning(KolaKerning.label)
                .textCase(.uppercase)
                .foregroundStyle(KolaColors.textSecondary)
            Text("AU$\(KolaFormatters.audDisplay(audAmount)) to \(recipientName)")
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
                Text(KolaFormatters.countdown(vm.remainingSeconds))
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
}

// MARK: - Pulse dot (F14)

/// Symbol-effect pulse on iOS 17+. Reduce-motion users get a static
/// filled circle. Kept in a small wrapper so the holding banner
/// reads as a row of nouns (`PulseDot`) rather than an inline blob.
private struct PulseDot: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        Image(systemName: "circle.fill")
            .font(.system(size: 10))
            .foregroundStyle(KolaColors.warning)
            .symbolEffect(.pulse, options: .repeating, isActive: !reduceMotion)
            .accessibilityHidden(true)
    }
}

// MARK: - Lifecycle modifier (F13)

/// Hoists the four lifecycle hooks (`.task`, `.onDisappear`,
/// `.onChange(of: scenePhase)`, `.onReceive(Timer.publish)`) into one
/// modifier so the view body is purely visual. F3: scene-phase active
/// also calls `resync()` so a backgrounded → foreground transition
/// snaps the countdown to the wall clock.
private struct FloatPausedLifecycle: ViewModifier {
    let vm: FloatPausedViewModel
    @Environment(\.scenePhase) private var scenePhase

    func body(content: Content) -> some View {
        content
            .task { vm.start() }
            .onDisappear { vm.stop() }
            .onChange(of: scenePhase) { _, phase in
                switch phase {
                case .active:
                    vm.resync()
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
    }
}
