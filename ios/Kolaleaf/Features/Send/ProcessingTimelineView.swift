// ProcessingTimelineView.swift  (Phase 6 · U49 → iter-2 C1 wiring)
// Vertical timeline showing where the active transfer is in the
// state machine. Reads from `ProcessingTimelineViewModel`, which
// owns the polling loop and the state-only-advances enforcement.
//
// Phase 7 iter-2 C1 / ADV-P7-C1: fires `onTerminal(transferId)` when
// the polled status crosses into a coordinator-terminal state
// (COMPLETED / NGN_SENT / sad-paths). Parent SendTabRoot uses the
// callback to push the next destination (Receipt for happy path,
// stack-pop for sad-path placeholders in Phase 7).

import SwiftUI

public struct ProcessingTimelineView: View {

    @State private var vm: ProcessingTimelineViewModel
    // Iter-2 W20 / ADV-P6-W3: pause polling while backgrounded.
    @Environment(\.scenePhase) private var scenePhase
    /// C1: fired once per terminal-status transition. Caller looks
    /// up the matching Recipient + Transfer and routes via the
    /// SendCoordinator.
    private let onTerminal: ((String, TransferStatus) -> Void)?
    /// Guard so we fire `onTerminal` at most once per view lifetime.
    @State private var didFireTerminal: Bool = false

    public init(
        api: AuthAPI,
        transferId: String,
        initialStatus: TransferStatus,
        appState: AppState? = nil,
        onTerminal: ((String, TransferStatus) -> Void)? = nil
    ) {
        _vm = State(initialValue: ProcessingTimelineViewModel(
            api: api,
            transferId: transferId,
            initialStatus: initialStatus,
            appState: appState
        ))
        self.onTerminal = onTerminal
    }

    public var body: some View {
        ScrollView {
            VStack(spacing: KolaSpacing.card) {
                header
                timeline
                if let err = vm.lastError {
                    Text(err)
                        .font(KolaFont.timestamp)
                        .foregroundStyle(KolaColors.coral)
                        .multilineTextAlignment(.center)
                }
            }
            .padding(.horizontal, KolaSpacing.xl)
            .padding(.top, KolaSpacing.xxl)
            .padding(.bottom, KolaSpacing.homeIndicator)
        }
        .background(KolaColors.surface.ignoresSafeArea())
        .task { vm.startPolling() }
        .onDisappear { vm.stopPolling() }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                vm.startPolling()
            case .background, .inactive:
                vm.stopPolling()
            @unknown default:
                vm.stopPolling()
            }
        }
        .onChange(of: vm.currentStatus) { _, newStatus in
            // C1: route on terminal. The view model already stops
            // polling on terminal; we just notify the parent so it
            // can push the next destination.
            guard let onTerminal,
                  !didFireTerminal,
                  TransferTimeline.isTerminal(newStatus)
                    || newStatus == .ngnSent
            else { return }
            didFireTerminal = true
            onTerminal(vm.transferId, newStatus)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            Text(TransferTimeline.label(for: vm.currentStatus))
                .font(KolaFont.pageTitle)
                .kerning(KolaKerning.headline)
                .foregroundStyle(KolaColors.textPrimary)
            if let sub = TransferTimeline.subtitle(for: vm.currentStatus) {
                Text(sub)
                    .font(KolaFont.tagline)
                    .foregroundStyle(KolaColors.textSecondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var timeline: some View {
        let happy = TransferTimeline.happyPath
        let currentOrdinal = TransferTimeline.ordinal(for: vm.currentStatus) ?? -1
        return VStack(spacing: 0) {
            ForEach(Array(happy.enumerated()), id: \.element) { idx, status in
                row(status: status, ordinal: idx, currentOrdinal: currentOrdinal,
                    isLast: idx == happy.count - 1)
            }
        }
        .padding(.vertical, KolaSpacing.l)
        .frame(maxWidth: .infinity)
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
    private func row(
        status: TransferStatus,
        ordinal: Int,
        currentOrdinal: Int,
        isLast: Bool
    ) -> some View {
        let isDone = ordinal < currentOrdinal
        let isActive = ordinal == currentOrdinal
        HStack(alignment: .top, spacing: KolaSpacing.m) {
            VStack(spacing: 0) {
                marker(isDone: isDone, isActive: isActive)
                if !isLast {
                    Rectangle()
                        .fill(isDone ? KolaColors.trustGreen : KolaColors.border)
                        .frame(width: 2, height: 28)
                }
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(TransferTimeline.label(for: status))
                    .font(KolaFont.rowValue)
                    .foregroundStyle(
                        (isDone || isActive) ? KolaColors.textPrimary : KolaColors.mutedDisabled
                    )
                if let sub = TransferTimeline.subtitle(for: status), isActive {
                    Text(sub)
                        .font(KolaFont.tagline)
                        .foregroundStyle(KolaColors.textSecondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.bottom, isLast ? 0 : KolaSpacing.s)
        }
        .padding(.horizontal, KolaSpacing.xl)
    }

    private func marker(isDone: Bool, isActive: Bool) -> some View {
        ZStack {
            Circle()
                .fill(isDone ? KolaColors.trustGreen : (isActive ? KolaColors.leafGreen : KolaColors.surfaceSoft))
                .frame(width: 22, height: 22)
            if isDone {
                Image(systemName: "checkmark")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(.white)
            } else if isActive {
                // Active row pulses; reduce-motion users still see the
                // fully-filled circle, just without the animation.
                Circle()
                    .fill(.white)
                    .frame(width: 8, height: 8)
            }
        }
    }
}
