// ActivityTabView.swift  (Phase 8 · U55 — iter-2 M4/M6/M7 + N3/N18)
// Screen 26 — the Activity tab landing screen.
//   • Totals card ("Sent this month" · AUD sum)
//   • Filter chips (All / Pending / Completed / Failed)
//   • Transaction rows with status pills
//   • Pull-to-refresh
//   • Pagination on near-end scroll
//   • Tap row → TransactionDetailView (push within the tab's own
//     NavigationStack — wired from MainTabView).
//
// Iter-2 (M4): the totals card has an explicit footnote that the
// number reflects ONLY the paginated rows we've fetched so far.
// Iter-1 silently undercounted a user with >20 transfers/month — the
// rollup card claimed "Sent this month: $750" when the truth was
// $2300+ across pages 2-N. The honest fix is a server-side
// `/account/totals` endpoint (see TODO below); until then we render
// the number with the caveat instead of lying.

import SwiftUI

public struct ActivityTabView: View {

    @Environment(\.apiClient) private var apiClient
    @Environment(\.swiftDataStack) private var stack
    @Environment(\.syncService) private var injectedSync

    @State private var vm: ActivityViewModel?

    public init() {}

    public var body: some View {
        VStack(spacing: 0) {
            switch vm?.state {
            case .none, .idle, .loading:
                loadingState
            case .loaded(let transfers):
                loadedContent(transfers: transfers)
            case .sessionExpired:
                sessionExpiredState
            case .failed(let message):
                failedState(message: message)
            }
        }
        .background(KolaColors.surface.ignoresSafeArea())
        .navigationTitle("Activity")
        .navigationBarTitleDisplayMode(.large)
        .task {
            if vm == nil {
                // Iter-2 (P5): reuse the app-root SyncService when
                // injected so all features share one cache writer.
                // Fall back to a local instance for previews + tests
                // that don't wire the environment.
                let sync = injectedSync
                    ?? SyncService(api: apiClient, stack: stack)
                vm = ActivityViewModel(api: apiClient, sync: sync)
            }
            await vm?.load()
        }
    }

    // MARK: - Loaded

    @ViewBuilder
    private func loadedContent(transfers: [TransferShape]) -> some View {
        let filterBinding = Binding<ActivityViewModel.FilterChip>(
            get: { vm?.selectedFilter ?? .all },
            set: { vm?.selectedFilter = $0 }
        )

        ScrollView {
            VStack(alignment: .leading, spacing: KolaSpacing.card) {
                totalsCard
                ActivityFilterChips(selection: filterBinding)

                if transfers.isEmpty {
                    emptyState
                } else {
                    transferList(transfers: transfers)
                }
            }
            .padding(.bottom, KolaSpacing.homeIndicator)
        }
        .refreshable { await vm?.reload() }
    }

    private var totalsCard: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            Text("Sent this month")
                .font(KolaFont.fieldLabel)
                .textCase(.uppercase)
                .kerning(KolaKerning.label)
                .foregroundStyle(KolaColors.textSecondary)
            Text(AmountFormatter.aud(vm?.totalsThisMonth ?? 0))
                .font(KolaFont.amountMedium)
                .kerning(KolaKerning.amount)
                .foregroundStyle(KolaColors.textPrimary)
            // Iter-2 (M4): surface the pagination gap so we don't
            // silently undercount a user with >20 transfers/month.
            // TODO(backend): replace with /account/totals or
            // /transfers/summary so the rollup reflects the full
            // history server-side.
            Text("From your most recent transfers")
                .font(KolaFont.timestamp)
                .foregroundStyle(KolaColors.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(KolaSpacing.card)
        .background(
            RoundedRectangle(cornerRadius: KolaRadius.card)
                .fill(KolaColors.Card.background)
        )
        .padding(.horizontal, KolaSpacing.xl)
        .padding(.top, KolaSpacing.xl)
    }

    @ViewBuilder
    private func transferList(transfers: [TransferShape]) -> some View {
        LazyVStack(spacing: KolaSpacing.s) {
            ForEach(transfers) { transfer in
                NavigationLink(value: ActivityDestination.detail(transferId: transfer.id)) {
                    ActivityRow(transfer: transfer)
                }
                .buttonStyle(.plain)
                .onAppear {
                    // Pagination trigger: when one of the last 5 rows
                    // appears we ask the VM to fetch the next page.
                    if let idx = transfers.firstIndex(of: transfer),
                       idx >= transfers.count - 5 {
                        Task { await vm?.loadNextPageIfNeeded() }
                    }
                }
            }
        }
        .padding(.horizontal, KolaSpacing.xl)
    }

    private var emptyState: some View {
        VStack(spacing: KolaSpacing.m) {
            Text("No transfers yet")
                .font(KolaFont.section)
                .foregroundStyle(KolaColors.textPrimary)
            Text("Your transfers will show here.")
                .font(KolaFont.row)
                .foregroundStyle(KolaColors.textSecondary)
        }
        .padding(.top, KolaSpacing.xxxl)
        .frame(maxWidth: .infinity)
    }

    // MARK: - Other states

    private var loadingState: some View {
        KolaPlaceholder.loading()
    }

    private var sessionExpiredState: some View {
        KolaPlaceholder.sessionExpired(message: "Sign in to see your activity.")
    }

    private func failedState(message: String) -> some View {
        KolaPlaceholder.failed(
            title: "Couldn't load activity",
            message: message,
            onRetry: { Task { await vm?.reload() } }
        )
    }
}

// MARK: - Row

struct ActivityRow: View {
    let transfer: TransferShape

    var body: some View {
        HStack(spacing: KolaSpacing.m) {
            VStack(alignment: .leading, spacing: KolaSpacing.xxs) {
                Text(AmountFormatter.aud(Decimal(string: transfer.sendAmount) ?? 0))
                    .font(KolaFont.rowTotal)
                    .foregroundStyle(KolaColors.textPrimary)
                Text(Self.statusLabel(transfer.status))
                    .font(KolaFont.row)
                    .foregroundStyle(Self.statusColor(transfer.status))
            }
            Spacer()
            if let created = transfer.createdAt {
                Text(KolaDateFormatters.monthDay.string(from: created))
                    .font(KolaFont.timestamp)
                    .foregroundStyle(KolaColors.textSecondary)
            }
        }
        .padding(KolaSpacing.l)
        .background(
            RoundedRectangle(cornerRadius: KolaRadius.card)
                .fill(KolaColors.Card.background)
        )
    }

    /// Iter-2 (M6 / M7): NGN_SENT is *in-flight*, not "Completed".
    /// REFUNDED is a terminal-failure outcome (money came back to the
    /// user) — label it "Refunded" and colour it warning-orange, not
    /// completed-green. Every other case maps through the centralised
    /// TransferStatus buckets so future statuses route consistently.
    static func statusLabel(_ status: TransferStatus) -> String {
        switch status {
        case .completed:           return "Completed"
        case .ngnSent:             return "Sending now"
        case .ngnFailed:           return "Failed"
        case .needsManual:         return "Needs review"
        case .refunded:            return "Refunded"
        case .cancelled:           return "Cancelled"
        case .expired:             return "Expired"
        case .floatInsufficient:   return "Paused"
        case .created, .awaitingAud,
             .audReceived, .processingNgn,
             .ngnRetry, .unknown:  return "In progress"
        }
    }

    /// Colour mirrors the label semantics — green only when the
    /// transfer is genuinely complete, orange for warning states
    /// (paused / refunded / sending-now), red for terminal failures.
    static func statusColor(_ status: TransferStatus) -> Color {
        switch status {
        case .completed:
            return KolaColors.leafGreen
        case .ngnSent:
            return KolaColors.warning
        case .ngnFailed, .needsManual, .cancelled, .expired:
            return KolaColors.coral
        case .refunded:
            return KolaColors.warning
        case .floatInsufficient:
            return KolaColors.warning
        default:
            return KolaColors.textSecondary
        }
    }
}

// MARK: - Navigation

public enum ActivityDestination: Hashable {
    case detail(transferId: String)
}
