// ActivityViewModel.swift  (Phase 8 · U55 — iter-2 fixes M4/M5/M6/M7 + N2/N5/N11/A3)
// Drives the Activity tab. Owns:
//   • The cursor-paginated transfer list (`GET /api/v1/transfers`).
//   • The active status filter chip (All / Pending / Completed / Failed).
//   • The "this month" totals card aggregate.
//
// Filter mapping (Iter-2 / A3 — buckets live on TransferStatus now):
//   .all       → no `status` query item
//   .pending   → TransferStatus.inFlight
//   .completed → TransferStatus.terminalSuccess   ({.completed} only)
//   .failed    → TransferStatus.terminalFailure   (.refunded lives here)
//
// Iter-1 leaked two bugs through the chip mapping:
//   • REFUNDED rolled up under "Completed" (M7) while ActivityRow
//     painted it warning-orange — UI and audit disagreed.
//   • NGN_SENT rolled up under "Completed" (M6) — it's *in-flight*
//     per the Transfer state machine even though the recipient often
//     sees money within seconds.
// Iter-2 routes both through the same `TransferStatus.terminal*`
// buckets that Statements + future audit/analytics will share.
//
// Iter-2 (M5 — filter pagination): when a multi-state chip is active
// the backend still doesn't fan out a status array — it accepts ONE
// Prisma literal per request. Iter-1 fetched a single page (20 rows),
// filtered client-side, and silently dropped any matches that lived
// further down the list. iter-2 paginates UNTIL the filter has rows
// OR we've exhausted the backend. Wasteful, but honest; the cleaner
// fix lives behind a backend change.
//
// Iter-2 (M4 — totals undercount): the "Sent this month" total still
// only sees the rows we've paginated so far. Iter-2 documents the
// limitation in a footnote so the user is not lied to; the eventual
// fix is a backend `/account/totals` (TODO below).
//
// Iter-2 (M1 / N11): the month-total calendar pins to Australia/Sydney
// so a user in PST sees the AEST month boundary, not their device's.

import Foundation
import Observation

@MainActor
@Observable
public final class ActivityViewModel {

    public enum FilterChip: String, CaseIterable, Identifiable, Sendable {
        // Identity vs display (iter-2 / N2): rawValue is the
        // identifier ("all"/"pending"/…) so analytics + persistence
        // keys stay stable when copy changes. `displayName` is the
        // UI label.
        case all       = "all"
        case pending   = "pending"
        case completed = "completed"
        case failed    = "failed"

        public var id: String { rawValue }

        /// User-facing chip label. The View ForEach should read this,
        /// not `rawValue` — iter-1 mixed identity and display through
        /// `rawValue` and produced two disagreeing tests.
        public var displayName: String {
            switch self {
            case .all:
                return String(
                    localized: "activity.filter.all",
                    defaultValue: "All"
                )
            case .pending:
                return String(
                    localized: "activity.filter.pending",
                    defaultValue: "Pending"
                )
            case .completed:
                return String(
                    localized: "activity.filter.completed",
                    defaultValue: "Completed"
                )
            case .failed:
                return String(
                    localized: "activity.filter.failed",
                    defaultValue: "Failed"
                )
            }
        }

        /// Backend Prisma literal subset this chip maps to. `.all`
        /// is `nil` (no `status` query item).
        var statusBucket: Set<TransferStatus>? {
            switch self {
            case .all:       return nil
            case .pending:   return TransferStatus.inFlight
            case .completed: return TransferStatus.terminalSuccess
            case .failed:    return TransferStatus.terminalFailure
            }
        }
    }

    public enum State: Equatable {
        case idle
        case loading
        case loaded([TransferShape])
        case sessionExpired
        case failed(String)
    }

    public private(set) var state: State = .idle
    public private(set) var totalsThisMonth: Decimal = 0
    public private(set) var nextCursor: String?
    public private(set) var isLoadingNextPage: Bool = false

    public var selectedFilter: FilterChip = .all {
        didSet {
            guard selectedFilter != oldValue else { return }
            // Skip didSet-triggered reload while the VM is still in
            // its pre-load state (.idle). The caller is about to call
            // `load()` explicitly; firing a concurrent reload here
            // races against the staged response queue and the
            // explicit-load result depending on actor scheduling.
            // Once we've loaded at least once, chip toggles do
            // trigger a refresh.
            if case .idle = state { return }
            Task { await reload() }
        }
    }

    private let api: AuthAPI
    private let sync: SyncService?
    /// Page size. Backend clamps to 100; 20 matches the Phase 4
    /// recipients-page convention.
    private let pageSize: Int = 20
    /// Iter-2 (M5): max pages we'll chase while filtering a single
    /// chip selection. Caps the network cost so a user toggling
    /// .failed against a million-row history doesn't loop forever.
    /// At pageSize=20 this is 200 rows; enough for the wave-1
    /// average-user blast radius and a sane safety net.
    private let filterMaxPages: Int = 10

    public init(api: AuthAPI, sync: SyncService? = nil) {
        self.api = api
        self.sync = sync
    }

    /// First-load entry point. Renders cached data immediately (if a
    /// SyncService is wired), then fires a network refresh.
    public func load() async {
        // Offline-first: paint cached rows so the screen isn't blank.
        if let sync, case .idle = state {
            // Iter-2 (A2): SyncService.cachedTransfers() now returns
            // Domain `Transfer`. Bridge back to the wire shape at the
            // VM boundary until State migrates to the Domain type.
            let cached = sync.cachedTransfers().map { $0.toWireShape() }
            if !cached.isEmpty {
                state = .loaded(filtered(cached))
                totalsThisMonth = computeMonthTotal(cached)
            }
        }
        if case .idle = state { state = .loading }
        await fetchFirstPage()
    }

    /// Pull-to-refresh entry point — re-fetches the first page.
    public func reload() async {
        nextCursor = nil
        await fetchFirstPage()
    }

    /// Pagination — load the next page when the user scrolls near the
    /// end. No-op when there are no more rows or a page is in flight.
    public func loadNextPageIfNeeded() async {
        guard let cursor = nextCursor, !isLoadingNextPage else { return }
        isLoadingNextPage = true
        defer { isLoadingNextPage = false }

        let result = await api.send(TransfersEndpoints.List(
            status: nil,
            limit: pageSize,
            cursor: cursor
        ))
        switch result {
        case .success(let response):
            let existing = rawRows()
            let merged = existing + response.transfers
            sync?.upsertTransfers(response.transfers)
            setRawRows(merged)
            totalsThisMonth = computeMonthTotal(merged)
            nextCursor = response.nextCursor
        case .failure(let err):
            // On pagination failure don't blow away the loaded page —
            // just log via state. The user can retry by scrolling
            // again; the page will refresh on next foreground.
            if case .unauthorized = err { state = .sessionExpired }
        }
    }

    // MARK: - Private

    private func fetchFirstPage() async {
        let result = await api.send(TransfersEndpoints.List(
            status: nil,
            limit: pageSize,
            cursor: nil
        ))
        switch result {
        case .success(let response):
            sync?.upsertTransfers(response.transfers)
            var collected = response.transfers
            var cursor = response.nextCursor

            // Iter-2 (M5): for a non-`.all` chip, paginate forward
            // until we either pick up some rows that match the bucket
            // or run out of backend pages (capped by filterMaxPages
            // so a deep history doesn't stall the UI).
            if selectedFilter != .all,
               let bucket = selectedFilter.statusBucket {
                var pagesChased = 1  // we already pulled the first one
                while filtered(collected, bucket: bucket).isEmpty,
                      let next = cursor,
                      pagesChased < filterMaxPages {
                    let pageResult = await api.send(TransfersEndpoints.List(
                        status: nil, limit: pageSize, cursor: next
                    ))
                    guard case .success(let pageResp) = pageResult else { break }
                    sync?.upsertTransfers(pageResp.transfers)
                    collected += pageResp.transfers
                    cursor = pageResp.nextCursor
                    pagesChased += 1
                }
            }

            setRawRows(collected)
            totalsThisMonth = computeMonthTotal(collected)
            nextCursor = cursor
        case .failure(let err):
            switch err {
            case .unauthorized:
                state = .sessionExpired
            default:
                // Keep cached rows visible if the network drops.
                if case .loaded = state { return }
                state = .failed(err.errorDescription
                                ?? String(
                                    localized: "activity.load_failed",
                                    defaultValue: "Couldn't load your activity."
                                ))
            }
        }
    }

    /// The raw (unfiltered) row set we've paginated so far. We keep
    /// the full list in `_rawRows` so toggling chips doesn't drop
    /// rows we've already paid the network cost for.
    private var _rawRows: [TransferShape] = []

    private func rawRows() -> [TransferShape] { _rawRows }

    private func setRawRows(_ rows: [TransferShape]) {
        _rawRows = rows
        state = .loaded(filtered(rows))
    }

    /// Apply client-side filtering for the active chip.
    private func filtered(_ transfers: [TransferShape]) -> [TransferShape] {
        guard let bucket = selectedFilter.statusBucket else {
            return transfers
        }
        return filtered(transfers, bucket: bucket)
    }

    private func filtered(_ transfers: [TransferShape],
                          bucket: Set<TransferStatus>) -> [TransferShape] {
        transfers.filter { bucket.contains($0.status) }
    }

    /// Iter-2 (M1/N11): month-total uses Australia/Sydney so a user
    /// who flies to LA on the 31st doesn't see their AU month roll
    /// over a day late.
    private func computeMonthTotal(_ transfers: [TransferShape]) -> Decimal {
        let cal = StatementsViewModel.auCalendar
        let nowAU = Date()
        let start = cal.dateInterval(of: .month, for: nowAU)?.start ?? nowAU
        let end = cal.dateInterval(of: .month, for: nowAU)?.end ?? nowAU
        return transfers.reduce(into: Decimal(0)) { acc, transfer in
            // Iter-2 (M2): only terminal-success rows count toward
            // "Sent this month" — refunds and failures didn't leave
            // the user's wallet net.
            guard TransferStatus.terminalSuccess.contains(transfer.status) else {
                return
            }
            // Iter-2 (M3): use completedAt when present.
            let bucketDate = transfer.completedAt ?? transfer.createdAt
            guard let date = bucketDate,
                  date >= start, date < end,
                  let amount = Decimal(string: transfer.sendAmount) else {
                return
            }
            acc += amount
        }
    }
}
