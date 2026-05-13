// CancelTransferView.swift  (Phase 9 · U62 + iter-2 A1/B4/B6/B8/C1/C5)
// Screen 39 — destructive cancel CTA with safety reassurance.
// Single-tap commit (the screen IS the confirm); no second-step
// sheet. Routes back to Activity on success via `onCancelled`.
//
// iter-2 changes:
//  • B4 / OO-904: error case payload is APIError; we render through
//    `APIErrorPresenter.userFacingMessage(for:fallback:)`.
//  • B6 / API-904: `onViewTransfer` renamed to `onTrackTransfer` and
//    typed with `(transferId: String)` so the call site routes
//    explicitly.
//  • B8 / ADV-P9-S3: `onCancelled` carries the Domain Transfer
//    captured from the cancel response so the parent threads the real
//    DTO into AppState / SendCoordinator (no stub).
//  • C1 / ADV-P9-C3: the "AUD never left your bank" reassurance only
//    appears in the active-decision states (.idle / .cancelling /
//    .error). Hidden in .cancelled / .tooLate / .gone where the user's
//    intent is settled.
//  • C5 / ADV-P9-W1: 404 maps to .gone — render a one-shot toast and
//    pop to Activity, same callback as cancel-success.

import SwiftUI

public struct CancelTransferView: View {

    @State private var vm: CancelTransferViewModel
    private let transferId: String
    /// Fired exactly once on a successful cancel OR an idempotent
    /// terminal-equivalent (.gone). Carries the Domain Transfer when
    /// the response had one; nil for .gone (the row is no longer
    /// fetchable, so the parent should drop AppState.activeTransfer
    /// rather than mirror a stale shape).
    private let onCancelled: (Transfer?) -> Void
    /// Fired when the user taps "View transfer" in the .tooLate
    /// branch. Caller pops back to the processing timeline so the
    /// user can track the AUD that just arrived.
    private let onTrackTransfer: (String) -> Void
    /// Fired when the user taps "Keep waiting" — pops back to PayID
    /// instructions. Plain dismiss; no state change.
    private let onDismiss: () -> Void

    public init(
        api: AuthAPI,
        transferId: String,
        onCancelled: @escaping (Transfer?) -> Void,
        onTrackTransfer: @escaping (String) -> Void,
        onDismiss: @escaping () -> Void
    ) {
        self.transferId = transferId
        _vm = State(initialValue: CancelTransferViewModel(
            api: api,
            transferId: transferId
        ))
        self.onCancelled = onCancelled
        self.onTrackTransfer = onTrackTransfer
        self.onDismiss = onDismiss
    }

    public var body: some View {
        VStack(spacing: KolaSpacing.card) {
            Spacer(minLength: 0)
            header
            // C1: reassurance is decision-time copy. After the user has
            // committed (.cancelled / .gone) or learned they can't
            // cancel (.tooLate) it would read as redundant.
            switch vm.state {
            case .idle, .cancelling, .error:
                reassurance
            case .cancelled, .tooLate, .gone:
                EmptyView()
            }
            Spacer()
            content
        }
        .padding(.horizontal, KolaSpacing.xl)
        .padding(.top, KolaSpacing.xxl)
        .padding(.bottom, KolaSpacing.homeIndicator)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(KolaColors.surface.ignoresSafeArea())
        .onChange(of: vm.state) { _, newState in
            switch newState {
            case .cancelled:
                onCancelled(vm.lastCancelledTransfer)
            case .gone:
                // C5: 404 — same UX as cancelled (pop to Activity).
                // No transfer to thread; parent should drop the
                // active-transfer mirror.
                onCancelled(nil)
            default:
                break
            }
        }
    }

    // MARK: - Subviews

    private var header: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            Text("Cancel this transfer?")
                .font(KolaFont.pageTitle)
                .kerning(KolaKerning.headline)
                .foregroundStyle(KolaColors.textPrimary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var reassurance: some View {
        // The user hasn't pushed AUD yet (cancel is only reachable in
        // AWAITING_AUD), so there is nothing to refund. Surface that
        // up-front so the user can cancel without anxiety.
        Text("Your AUD never left your bank — nothing to refund.")
            .font(KolaFont.row)
            .foregroundStyle(KolaColors.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder
    private var content: some View {
        switch vm.state {
        case .idle, .cancelling, .error:
            ctaStack
        case .cancelled, .gone:
            cancelledNotice
        case .tooLate:
            tooLateCard
        }
    }

    private var ctaStack: some View {
        VStack(spacing: KolaSpacing.m) {
            if case .error(let apiError) = vm.state {
                Text(APIErrorPresenter.userFacingMessage(
                    for: apiError,
                    fallback: "Could not cancel."
                ))
                    .font(KolaFont.tagline)
                    .foregroundStyle(KolaColors.coral)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, KolaSpacing.m)
                    .padding(.vertical, KolaSpacing.s)
                    .background(
                        RoundedRectangle(cornerRadius: KolaRadius.chip, style: .continuous)
                            .fill(KolaColors.coral.opacity(0.08))
                    )
            }
            Button(action: { Task { await vm.cancel() } }) {
                HStack(spacing: KolaSpacing.s) {
                    if vm.state == .cancelling {
                        ProgressView()
                            .progressViewStyle(.circular)
                            .tint(.white)
                    }
                    Text(vm.state == .cancelling ? "Cancelling…" : "Cancel transfer")
                        .font(KolaFont.cta)
                        .kerning(KolaKerning.cta)
                        .foregroundStyle(.white)
                }
                .frame(maxWidth: .infinity, minHeight: KolaSpacing.hitTarget + 6)
                .background(
                    RoundedRectangle(cornerRadius: KolaRadius.cta, style: .continuous)
                        .fill(KolaColors.coral)
                )
            }
            .buttonStyle(.plain)
            .disabled(vm.state == .cancelling)
            .accessibilityIdentifier("cancel.confirm")

            Button(action: onDismiss) {
                Text("Keep waiting")
                    .font(KolaFont.cta)
                    .foregroundStyle(KolaColors.trustGreen)
                    .frame(maxWidth: .infinity, minHeight: KolaSpacing.hitTarget)
            }
            .buttonStyle(.plain)
        }
    }

    private var cancelledNotice: some View {
        // Mostly a transient frame — onChange fires onCancelled which
        // pops the stack — but we still draw something coherent in
        // case the navigation pop is delayed by a frame.
        VStack(spacing: KolaSpacing.s) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 32))
                .foregroundStyle(KolaColors.trustGreen)
            Text(vm.state == .gone
                 ? "This transfer is no longer available."
                 : "Transfer cancelled")
                .font(KolaFont.cta)
                .foregroundStyle(KolaColors.textPrimary)
        }
        .frame(maxWidth: .infinity)
    }

    private var tooLateCard: some View {
        VStack(spacing: KolaSpacing.m) {
            KolaErrorCard(
                tint: KolaColors.warning,
                iconSystemName: "exclamationmark.triangle.fill",
                title: "Too late",
                message: "Your AUD has arrived. Track it instead.",
                retry: nil
            )
            Button(action: { onTrackTransfer(transferId) }) {
                Text("View transfer")
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
        }
    }
}
