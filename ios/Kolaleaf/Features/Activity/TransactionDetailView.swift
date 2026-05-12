// TransactionDetailView.swift  (Phase 7 · U52 → iter-2 W10/W15/C2)
// Per-transfer detail screen tapped from the Activity list. Renders
// the composed happy-path timeline plus provider refs (PayID
// reference + handle) when present.
//
// Iter-2 fixes:
//   • W10 / ADV-P7-W4: scenePhase-driven refresh on .active resume
//     + sad-path banner (NEEDS_MANUAL / NGN_FAILED / REFUNDED /
//     EXPIRED) rendered IN PLACE OF the timeline.
//   • W15 / API-003: rows are `TransferTimelineRow` (Domain).
//   • C2 / OO-001: AUD/NGN formatting via shared `AmountFormatter`.

import SwiftUI

public struct TransactionDetailView: View {

    @State private var vm: TransactionDetailViewModel
    @Environment(\.scenePhase) private var scenePhase

    public init(api: AuthAPI, transferId: String) {
        _vm = State(initialValue: TransactionDetailViewModel(
            api: api,
            transferId: transferId
        ))
    }

    public var body: some View {
        ScrollView {
            VStack(spacing: KolaSpacing.card) {
                switch vm.state {
                case .idle, .loading:
                    loadingState
                case .loaded(let detail):
                    loadedContent(detail: detail)
                case .notFound:
                    notFoundState
                case .sessionExpired:
                    sessionExpiredState
                case .failed(let message):
                    failedState(message: message)
                }
            }
            .padding(.horizontal, KolaSpacing.xl)
            .padding(.top, KolaSpacing.xxl)
            .padding(.bottom, KolaSpacing.homeIndicator)
        }
        .background(KolaColors.surface.ignoresSafeArea())
        .navigationTitle("Transfer")
        .navigationBarTitleDisplayMode(.inline)
        .task { await vm.load() }
        .onChange(of: scenePhase) { _, phase in
            // W10: re-fetch on resume so the transfer can settle while
            // the user was backgrounded. The VM's refreshOnResume is
            // a no-op if we never reached .loaded.
            if phase == .active {
                Task { await vm.refreshOnResume() }
            }
        }
    }

    // MARK: - Loaded content

    @ViewBuilder
    private func loadedContent(detail: TransactionDetailViewModel.TransactionDetail) -> some View {
        amountHeader(detail: detail)
        // W10: sad-path statuses render a "Contact support" banner
        // instead of the happy-path timeline. The timeline would mark
        // every row PENDING — not useful, and visually misleading.
        if isSadPath(detail.transfer.status) {
            sadPathBanner(transfer: detail.transfer)
        } else {
            timelineCard(rows: detail.rows)
        }
        providerRefsCard(
            payidReference: detail.payidReference,
            payidProviderRef: detail.payidProviderRef
        )
    }

    private func amountHeader(detail: TransactionDetailViewModel.TransactionDetail) -> some View {
        VStack(spacing: KolaSpacing.xs) {
            Text(TransferStateLabels.label(for: detail.transfer.status))
                .font(KolaFont.fieldLabel)
                .kerning(KolaKerning.label)
                .textCase(.uppercase)
                .foregroundStyle(KolaColors.textSecondary)
            // C2 / OO-001: shared formatter.
            Text(AmountFormatter.aud(detail.transfer.sendAmount))
                .font(KolaFont.amountMedium)
                .kerning(KolaKerning.amount)
                .foregroundStyle(KolaColors.textPrimary)
            if let received = detail.transfer.receiveAmount {
                Text(AmountFormatter.ngn(received))
                    .font(KolaFont.ngnAccent)
                    .foregroundStyle(KolaColors.leafGreen)
            }
        }
        .frame(maxWidth: .infinity)
    }

    private func timelineCard(rows: [TransferTimelineRow]) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.element.id) { idx, row in
                timelineRow(row, isLast: idx == rows.count - 1)
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

    private func timelineRow(
        _ row: TransferTimelineRow,
        isLast: Bool
    ) -> some View {
        HStack(alignment: .top, spacing: KolaSpacing.m) {
            VStack(spacing: 0) {
                marker(isDone: row.isDone, isActive: row.isActive)
                if !isLast {
                    Rectangle()
                        .fill(row.isDone ? KolaColors.trustGreen : KolaColors.border)
                        .frame(width: 2, height: 28)
                }
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(TransferStateLabels.label(for: row.status))
                    .font(KolaFont.rowValue)
                    .foregroundStyle(
                        (row.isDone || row.isActive)
                            ? KolaColors.textPrimary
                            : KolaColors.mutedDisabled
                    )
                if let sub = TransferStateLabels.subtitle(for: row.status), row.isActive {
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
                .fill(isDone
                      ? KolaColors.trustGreen
                      : (isActive ? KolaColors.leafGreen : KolaColors.surfaceSoft))
                .frame(width: 22, height: 22)
            if isDone {
                Image(systemName: "checkmark")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(.white)
            } else if isActive {
                Circle()
                    .fill(.white)
                    .frame(width: 8, height: 8)
            }
        }
    }

    // MARK: - Sad-path banner (W10 / ADV-P7-W4)

    private func isSadPath(_ status: TransferStatus) -> Bool {
        switch status {
        case .needsManual, .ngnFailed, .refunded, .expired:
            return true
        default:
            return false
        }
    }

    private func sadPathBanner(transfer: Transfer) -> some View {
        let reference = transfer.payidReference ?? transfer.id
        return KolaErrorCard(
            tint: KolaColors.coral,
            iconSystemName: "exclamationmark.octagon.fill",
            title: TransferStateLabels.label(for: transfer.status),
            message: "Something went wrong with this transfer. Contact support with reference \(reference) and we'll sort it out.",
            retry: nil
        )
    }

    @ViewBuilder
    private func providerRefsCard(
        payidReference: String?,
        payidProviderRef: String?
    ) -> some View {
        if payidReference != nil || payidProviderRef != nil {
            VStack(alignment: .leading, spacing: KolaSpacing.s) {
                Text("Reference")
                    .font(KolaFont.fieldLabel)
                    .kerning(KolaKerning.label)
                    .textCase(.uppercase)
                    .foregroundStyle(KolaColors.textSecondary)
                if let ref = payidReference {
                    refRow(label: "Kolaleaf ref", value: ref)
                }
                if let provider = payidProviderRef {
                    refRow(label: "PayID", value: provider)
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
    }

    private func refRow(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(KolaFont.timestamp)
                .foregroundStyle(KolaColors.textSecondary)
            Text(value)
                .font(KolaFont.rowValue)
                .foregroundStyle(KolaColors.textPrimary)
                .textSelection(.enabled)
        }
    }

    // MARK: - Empty / failure states

    private var loadingState: some View {
        ProgressView()
            .progressViewStyle(.circular)
            .tint(KolaColors.trustGreen)
            .frame(maxWidth: .infinity, minHeight: 240)
    }

    private var notFoundState: some View {
        KolaErrorCard(
            tint: KolaColors.warning,
            iconSystemName: "questionmark.folder.fill",
            title: "Transfer not found",
            message: "We couldn't find that transfer. It may have been removed.",
            retry: nil
        )
    }

    private var sessionExpiredState: some View {
        KolaErrorCard(
            tint: KolaColors.coral,
            iconSystemName: "lock.fill",
            title: "Session expired",
            message: "Sign in again to view this transfer.",
            retry: nil
        )
    }

    private func failedState(message: String) -> some View {
        KolaErrorCard(
            tint: KolaColors.coral,
            iconSystemName: "exclamationmark.triangle.fill",
            title: "Couldn't load transfer",
            message: message,
            retry: KolaErrorCard.RetryAction(
                label: "Try again",
                hint: "Reloads the transfer",
                perform: { Task { await vm.load() } }
            )
        )
    }
}
