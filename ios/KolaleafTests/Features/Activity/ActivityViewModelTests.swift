// ActivityViewModelTests.swift  (Phase 8 · U55)
// Covers:
//   • Happy path: load() populates transfers + month total.
//   • Filter chips: switching to .completed filters out non-completed.
//   • Empty list: empty wire response → .loaded with empty array.
//   • Pagination: nextCursor drives a second fetch.
//   • Session expired: unauthorized → .sessionExpired.
//   • Month total: only transfers whose createdAt falls in this
//     calendar month count.

import XCTest
@testable import Kolaleaf

@MainActor
final class ActivityViewModelTests: XCTestCase {

    private var api: FakeAPIClient!

    override func setUp() async throws {
        try await super.setUp()
        api = FakeAPIClient()
    }

    override func tearDown() async throws {
        api = nil
        try await super.tearDown()
    }

    // MARK: - Happy path

    func test_load_happyPath_setsLoadedStateAndTotal() async {
        let now = Date()
        await api.stageSuccess(
            TransfersEndpoints.List.self,
            ListTransfersResponse(transfers: [
                .fixture(id: "t1", status: .completed,
                         sendAmount: "100.00", createdAt: now),
                .fixture(id: "t2", status: .processingNgn,
                         sendAmount: "50.00", createdAt: now),
            ], nextCursor: nil)
        )
        let vm = ActivityViewModel(api: api)

        await vm.load()

        guard case .loaded(let rows) = vm.state else {
            return XCTFail("Expected .loaded, got \(vm.state)")
        }
        XCTAssertEqual(rows.count, 2)
        // Iter-2 (M2): only terminal-success rows contribute to the
        // "sent this month" total. Iter-1 summed every transfer
        // including the in-flight processingNgn, which double-counted
        // refunds and showed pending money as already-sent.
        XCTAssertEqual(vm.totalsThisMonth, Decimal(string: "100.00"))
    }

    // MARK: - Filter chips

    func test_filter_completed_returnsOnlyTerminalSuccess() async {
        // Iter-2 (M7): REFUNDED is a terminal-FAILURE outcome — money
        // came back to the user instead of reaching the recipient. It
        // must NOT live under the .completed chip, and the row label
        // must agree with the chip bucket (ActivityRow paints it
        // orange, ActivityViewModel buckets it as failed).
        let now = Date()
        await api.stageSuccess(
            TransfersEndpoints.List.self,
            ListTransfersResponse(transfers: [
                .fixture(id: "t1", status: .completed, createdAt: now),
                .fixture(id: "t2", status: .processingNgn, createdAt: now),
                .fixture(id: "t3", status: .refunded, createdAt: now),
                .fixture(id: "t4", status: .ngnFailed, createdAt: now),
            ], nextCursor: nil)
        )
        let vm = ActivityViewModel(api: api)
        await vm.load()

        // didSet fires an unstructured `Task { reload }` in production
        // so the UI re-fetches when the user taps a chip. Tests drive
        // it deterministically by toggling the chip then awaiting
        // `reload()` directly — the unstructured Task races against
        // `Task.yield` and produces flaky orderings.
        vm.selectedFilter = .completed
        await vm.reload()

        guard case .loaded(let rows) = vm.state else {
            return XCTFail("Expected .loaded")
        }
        // Only the genuinely completed transfer — refunded sits in
        // .failed now.
        XCTAssertEqual(Set(rows.map(\.id)), Set(["t1"]))
    }

    func test_filter_failed_includesRefundedAndTerminalSadPath() async {
        // Iter-2 (M7): REFUNDED belongs in the failed bucket alongside
        // ngnFailed/needsManual/expired/cancelled.
        let now = Date()
        await api.stageSuccess(
            TransfersEndpoints.List.self,
            ListTransfersResponse(transfers: [
                .fixture(id: "t1", status: .completed, createdAt: now),
                .fixture(id: "t2", status: .ngnFailed, createdAt: now),
                .fixture(id: "t3", status: .needsManual, createdAt: now),
                .fixture(id: "t4", status: .expired, createdAt: now),
                .fixture(id: "t5", status: .cancelled, createdAt: now),
                .fixture(id: "t6", status: .refunded, createdAt: now),
            ], nextCursor: nil)
        )
        let vm = ActivityViewModel(api: api)
        await vm.load()

        vm.selectedFilter = .failed
        await vm.reload()

        guard case .loaded(let rows) = vm.state else {
            return XCTFail("Expected .loaded")
        }
        XCTAssertEqual(Set(rows.map(\.id)),
                       Set(["t2", "t3", "t4", "t5", "t6"]))
    }

    func test_filter_pending_includesInFlightAndRetry() async {
        let now = Date()
        await api.stageSuccess(
            TransfersEndpoints.List.self,
            ListTransfersResponse(transfers: [
                .fixture(id: "t1", status: .created, createdAt: now),
                .fixture(id: "t2", status: .processingNgn, createdAt: now),
                .fixture(id: "t3", status: .ngnRetry, createdAt: now),
                .fixture(id: "t4", status: .completed, createdAt: now),
            ], nextCursor: nil)
        )
        let vm = ActivityViewModel(api: api)
        await vm.load()

        vm.selectedFilter = .pending
        await vm.reload()

        guard case .loaded(let rows) = vm.state else {
            return XCTFail("Expected .loaded")
        }
        XCTAssertEqual(Set(rows.map(\.id)), Set(["t1", "t2", "t3"]))
    }

    // MARK: - Empty

    func test_load_emptyList_setsLoadedWithEmptyArray() async {
        await api.stageSuccess(
            TransfersEndpoints.List.self,
            ListTransfersResponse(transfers: [], nextCursor: nil)
        )
        let vm = ActivityViewModel(api: api)
        await vm.load()

        guard case .loaded(let rows) = vm.state else {
            return XCTFail("Expected .loaded")
        }
        XCTAssertTrue(rows.isEmpty)
        XCTAssertEqual(vm.totalsThisMonth, 0)
    }

    // MARK: - Pagination

    func test_pagination_loadNextPage_appendsTransfers() async {
        let now = Date()
        // First page returns 2 transfers + a cursor.
        await api.stageSequence(
            TransfersEndpoints.List.self,
            results: [
                .success(ListTransfersResponse(transfers: [
                    .fixture(id: "t1", status: .completed,
                             sendAmount: "10.00", createdAt: now),
                    .fixture(id: "t2", status: .completed,
                             sendAmount: "20.00", createdAt: now),
                ], nextCursor: "cursor_2")),
                .success(ListTransfersResponse(transfers: [
                    .fixture(id: "t3", status: .completed,
                             sendAmount: "30.00", createdAt: now),
                ], nextCursor: nil)),
            ]
        )
        let vm = ActivityViewModel(api: api)
        await vm.load()
        XCTAssertEqual(vm.nextCursor, "cursor_2")

        await vm.loadNextPageIfNeeded()

        guard case .loaded(let rows) = vm.state else {
            return XCTFail("Expected .loaded")
        }
        XCTAssertEqual(rows.count, 3)
        XCTAssertNil(vm.nextCursor)
    }

    func test_pagination_skipsWhenNoCursor() async {
        await api.stageSuccess(
            TransfersEndpoints.List.self,
            ListTransfersResponse(transfers: [
                .fixture(id: "t1", status: .completed, createdAt: Date()),
            ], nextCursor: nil)
        )
        let vm = ActivityViewModel(api: api)
        await vm.load()

        let callsBefore = await api.calls.count
        await vm.loadNextPageIfNeeded()
        let callsAfter = await api.calls.count

        XCTAssertEqual(callsBefore, callsAfter,
                       "loadNextPageIfNeeded must be a no-op when nextCursor is nil")
    }

    // MARK: - Session expired

    func test_load_unauthorized_setsSessionExpired() async {
        await api.stageFailure(
            TransfersEndpoints.List.self,
            .unauthorized
        )
        let vm = ActivityViewModel(api: api)
        await vm.load()

        XCTAssertEqual(vm.state, .sessionExpired)
    }

    // MARK: - Month total

    func test_totals_onlyCountsTransfersInCurrentMonth() async {
        let now = Date()
        // Date from 2 months ago. We rely on the simple comparison —
        // it must not match the current month window.
        let twoMonthsAgo = Calendar(identifier: .gregorian)
            .date(byAdding: .month, value: -2, to: now)!

        await api.stageSuccess(
            TransfersEndpoints.List.self,
            ListTransfersResponse(transfers: [
                .fixture(id: "thisMonth", status: .completed,
                         sendAmount: "100.00", createdAt: now),
                .fixture(id: "old", status: .completed,
                         sendAmount: "999.00", createdAt: twoMonthsAgo),
            ], nextCursor: nil)
        )
        let vm = ActivityViewModel(api: api)
        await vm.load()

        XCTAssertEqual(vm.totalsThisMonth, Decimal(string: "100.00"))
    }

    // Iter-2 (M5): filtering to a chip whose matching rows live on
    // page 2+ must paginate forward instead of silently dropping the
    // matches. Iter-1 only ran filter on the first page's 20 rows.
    func test_filter_paginatesUntilBucketHasMatches() async {
        let now = Date()
        await api.stageSequence(
            TransfersEndpoints.List.self,
            results: [
                // Page 1 = all completed, nothing matches .failed.
                .success(ListTransfersResponse(transfers: [
                    .fixture(id: "ok1", status: .completed, createdAt: now),
                    .fixture(id: "ok2", status: .completed, createdAt: now),
                ], nextCursor: "p2")),
                // Page 2 finally has the failed row.
                .success(ListTransfersResponse(transfers: [
                    .fixture(id: "fail", status: .ngnFailed, createdAt: now),
                ], nextCursor: nil)),
            ]
        )
        let vm = ActivityViewModel(api: api)
        vm.selectedFilter = .failed
        await vm.load()

        guard case .loaded(let rows) = vm.state else {
            return XCTFail("Expected .loaded, got \(vm.state)")
        }
        XCTAssertEqual(rows.map(\.id), ["fail"],
                       "Filter must paginate past empty pages")
    }

    // Iter-2 (M6): NGN_SENT is in-flight, NOT "Completed". Row must
    // label it "Sending now" with a warning color (not leafGreen).
    func test_row_ngnSent_labeledSendingNow_notCompleted() {
        XCTAssertEqual(ActivityRow.statusLabel(.ngnSent), "Sending now")
        XCTAssertEqual(ActivityRow.statusLabel(.completed), "Completed")
        XCTAssertNotEqual(ActivityRow.statusColor(.ngnSent),
                          KolaColors.leafGreen,
                          "ngnSent is in-flight — never paint it Completed-green")
        XCTAssertEqual(ActivityRow.statusColor(.completed),
                       KolaColors.leafGreen)
    }

    // Iter-2 (M7): the row label for REFUNDED must agree with the
    // chip bucket — both treat refunded as a terminal-failure state.
    func test_row_refunded_labeledRefunded_andOrangeWarning() {
        XCTAssertEqual(ActivityRow.statusLabel(.refunded), "Refunded")
        XCTAssertEqual(ActivityRow.statusColor(.refunded),
                       KolaColors.warning)
    }

    // Iter-2 (A3): centralised TransferStatus buckets are the single
    // source of truth — Activity, Statements, ActivityRow all map to
    // the same Set. Asserting the bucket membership protects against
    // accidental drift.
    func test_transferStatusBuckets_haveExpectedMembership() {
        XCTAssertEqual(TransferStatus.terminalSuccess, [.completed])
        XCTAssertTrue(TransferStatus.terminalFailure.contains(.refunded))
        XCTAssertTrue(TransferStatus.terminalFailure.contains(.ngnFailed))
        XCTAssertFalse(TransferStatus.terminalSuccess.contains(.ngnSent),
                       "ngnSent is in-flight, not terminal success")
        XCTAssertTrue(TransferStatus.inFlight.contains(.ngnSent))
        XCTAssertTrue(TransferStatus.inFlight.contains(.floatInsufficient))
    }

    // Iter-2 (N2): FilterChip rawValue is the identity ("all",
    // "completed", …) — UI must read `displayName` ("All",
    // "Completed", …) instead.
    func test_filterChip_rawValueAndDisplayNameAreDistinct() {
        XCTAssertEqual(ActivityViewModel.FilterChip.all.rawValue, "all")
        XCTAssertEqual(ActivityViewModel.FilterChip.all.displayName, "All")
        XCTAssertEqual(ActivityViewModel.FilterChip.completed.rawValue,
                       "completed")
        XCTAssertEqual(ActivityViewModel.FilterChip.completed.displayName,
                       "Completed")
    }
}
