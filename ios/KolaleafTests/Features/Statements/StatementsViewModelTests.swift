// StatementsViewModelTests.swift  (Phase 8 · U59)
// Covers:
//   • Happy path: load() aggregates transfers into a FY rollup +
//     monthly rows.
//   • FY boundary: 30 June 2025 belongs to FY 2024–25, not FY 2025–26.
//   • CSV synthesis: header row + comma-escaped rows.
//   • Empty FY: zero transfers → empty rows + zero rollup.
//   • Session expired: unauthorized → .sessionExpired.

import XCTest
@testable import Kolaleaf

@MainActor
final class StatementsViewModelTests: XCTestCase {

    // The reference date pins us to FY 2025–26 (1 Jul 2025 → 1 Jul 2026).
    private let referenceDate = makeDate(year: 2026, month: 5, day: 12)

    private static func makeDate(year: Int, month: Int, day: Int) -> Date {
        var comps = DateComponents()
        comps.year = year
        comps.month = month
        comps.day = day
        comps.hour = 12
        comps.timeZone = TimeZone(identifier: "Australia/Sydney")
        return Calendar(identifier: .gregorian).date(from: comps)!
    }

    func test_computeFYStartYear_julyOrLater_returnsCurrentYear() {
        let july = Self.makeDate(year: 2026, month: 7, day: 1)
        XCTAssertEqual(StatementsViewModel.computeFYStartYear(reference: july),
                       2026)
    }

    func test_computeFYStartYear_beforeJuly_returnsPreviousYear() {
        let june = Self.makeDate(year: 2026, month: 6, day: 30)
        XCTAssertEqual(StatementsViewModel.computeFYStartYear(reference: june),
                       2025)
    }

    func test_load_happyPath_aggregatesIntoMonthlyRows() async {
        let api = FakeAPIClient()
        let now = referenceDate  // FY 2025–26
        let lastMonth = Self.makeDate(year: 2026, month: 4, day: 10)

        await api.stageSuccess(
            TransfersEndpoints.List.self,
            ListTransfersResponse(transfers: [
                .fixture(id: "a", status: .completed,
                         sendAmount: "100.00", createdAt: now),
                .fixture(id: "b", status: .completed,
                         sendAmount: "50.00", createdAt: now),
                .fixture(id: "c", status: .completed,
                         sendAmount: "200.00", createdAt: lastMonth),
            ], nextCursor: nil)
        )

        let vm = StatementsViewModel(api: api, now: { now })
        await vm.load()

        guard case .loaded(let rollup, let rows) = vm.state else {
            return XCTFail("Expected .loaded, got \(vm.state)")
        }
        XCTAssertEqual(rollup, Decimal(string: "350.00"))
        XCTAssertEqual(rows.count, 2)
        // Sorted desc — May (current) row first.
        XCTAssertEqual(rows[0].month, 5)
        XCTAssertEqual(rows[0].total, Decimal(string: "150.00"))
        XCTAssertEqual(rows[0].transferCount, 2)
        XCTAssertEqual(rows[1].month, 4)
        XCTAssertEqual(rows[1].total, Decimal(string: "200.00"))
    }

    func test_fyBoundary_lastJune_excludedFromNextFY() async {
        let api = FakeAPIClient()
        let now = referenceDate
        let lastJune = Self.makeDate(year: 2025, month: 6, day: 30)
        let firstJuly = Self.makeDate(year: 2025, month: 7, day: 1)

        await api.stageSuccess(
            TransfersEndpoints.List.self,
            ListTransfersResponse(transfers: [
                .fixture(id: "oldFY", status: .completed,
                         sendAmount: "100.00", createdAt: lastJune),
                .fixture(id: "newFY", status: .completed,
                         sendAmount: "50.00", createdAt: firstJuly),
            ], nextCursor: nil)
        )

        let vm = StatementsViewModel(api: api, now: { now })
        await vm.load()

        guard case .loaded(let rollup, let rows) = vm.state else {
            return XCTFail("Expected .loaded")
        }
        // Only the 1 July transfer is in FY 2025–26.
        XCTAssertEqual(rollup, Decimal(string: "50.00"))
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].year, 2025)
        XCTAssertEqual(rows[0].month, 7)
    }

    // Iter-2 (M1): a transfer dated 1 July 2025 00:30 AEST must land
    // in FY 2025-26 even when the device is on America/Los_Angeles,
    // where the same instant reads as 30 June 2025 07:30. Iter-1
    // computed FY in device-local time and lost the boundary.
    func test_fyBoundary_pinnedToAustraliaSydney_notDeviceLocal() async {
        let api = FakeAPIClient()
        // Build 1 July 2025 00:30 AEST → same instant in absolute time.
        var comps = DateComponents()
        comps.year = 2025; comps.month = 7; comps.day = 1
        comps.hour = 0; comps.minute = 30
        comps.timeZone = TimeZone(identifier: "Australia/Sydney")
        let firstJulyEarlyAEST = Calendar(identifier: .gregorian)
            .date(from: comps)!

        // Reference "now" anywhere inside FY 2025-26.
        let now = Self.makeDate(year: 2025, month: 12, day: 1)

        await api.stageSuccess(
            TransfersEndpoints.List.self,
            ListTransfersResponse(transfers: [
                .fixture(id: "boundary", status: .completed,
                         sendAmount: "100.00",
                         createdAt: firstJulyEarlyAEST),
            ], nextCursor: nil)
        )
        let vm = StatementsViewModel(api: api, now: { now })
        await vm.load()

        guard case .loaded(let rollup, let rows) = vm.state else {
            return XCTFail("Expected .loaded")
        }
        // 1 July 00:30 AEST falls inside FY 2025-26 regardless of
        // device timezone.
        XCTAssertEqual(rollup, Decimal(string: "100.00"))
        XCTAssertEqual(rows.first?.year, 2025)
        XCTAssertEqual(rows.first?.month, 7)
    }

    // Iter-2 (M2): non-terminal-success rows must NOT count toward
    // the FY rollup. Audit + tax math counts gross dollars that
    // *completed*, not in-flight, refunded, cancelled, or failed.
    func test_aggregate_excludesNonTerminalSuccess() async {
        let api = FakeAPIClient()
        let now = referenceDate
        await api.stageSuccess(
            TransfersEndpoints.List.self,
            ListTransfersResponse(transfers: [
                .fixture(id: "ok",   status: .completed,
                         sendAmount: "100.00", createdAt: now),
                .fixture(id: "wip",  status: .ngnSent,
                         sendAmount: "999.00", createdAt: now),
                .fixture(id: "back", status: .refunded,
                         sendAmount: "999.00", createdAt: now),
                .fixture(id: "x",    status: .cancelled,
                         sendAmount: "999.00", createdAt: now),
                .fixture(id: "fail", status: .ngnFailed,
                         sendAmount: "999.00", createdAt: now),
            ], nextCursor: nil)
        )
        let vm = StatementsViewModel(api: api, now: { now })
        await vm.load()
        guard case .loaded(let rollup, _) = vm.state else {
            return XCTFail("Expected .loaded")
        }
        XCTAssertEqual(rollup, Decimal(string: "100.00"),
                       "Only .completed rows count toward the FY rollup")
    }

    // Iter-2 (M3): a transfer initiated 23:59 on 30 June that
    // completes 00:01 on 1 July belongs in the NEW FY (money moved
    // on 1 July). Iter-1 bucketed by createdAt and put it in the
    // old FY.
    func test_bucketing_usesCompletedAtNotCreatedAt() async {
        let api = FakeAPIClient()
        let now = Self.makeDate(year: 2025, month: 12, day: 1)  // FY 25-26
        let lateJune = Self.makeDate(year: 2025, month: 6, day: 30)
        let earlyJuly = Self.makeDate(year: 2025, month: 7, day: 1)
        await api.stageSuccess(
            TransfersEndpoints.List.self,
            ListTransfersResponse(transfers: [
                .fixture(id: "straddle", status: .completed,
                         sendAmount: "100.00",
                         completedAt: earlyJuly,
                         createdAt: lateJune),
            ], nextCursor: nil)
        )
        let vm = StatementsViewModel(api: api, now: { now })
        await vm.load()
        guard case .loaded(let rollup, _) = vm.state else {
            return XCTFail("Expected .loaded")
        }
        // Money moved on 1 July → counts in FY 2025-26.
        XCTAssertEqual(rollup, Decimal(string: "100.00"))
    }

    // Iter-2 (A4): csvFileURL writes the rollup to a temp file the
    // View can hand to UIActivityViewController.
    func test_csvFileURL_writesFileWithFYNameAndCsvHeader() async throws {
        let api = FakeAPIClient()
        let now = referenceDate
        // Stage recipients FIRST so the type-name-keyed stagedResults
        // doesn't get clobbered (TransfersEndpoints.List and
        // RecipientsEndpoints.List both stringify to "List" under
        // `String(describing:)`). The transfers stage is the one we
        // care about for the CSV body.
        await api.stageSuccess(
            RecipientsEndpoints.List.self,
            RecipientsListResponse(recipients: [])
        )
        await api.stageSuccess(
            TransfersEndpoints.List.self,
            ListTransfersResponse(transfers: [
                .fixture(id: "t1", status: .completed,
                         sendAmount: "100.00", createdAt: now),
            ], nextCursor: nil)
        )
        let vm = StatementsViewModel(api: api, now: { now })
        await vm.load()

        // Isolated temp directory so concurrent test runs don't
        // collide on the same file.
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(
            at: dir, withIntermediateDirectories: true
        )
        let url = try vm.csvFileURL(directory: dir)
        XCTAssertTrue(url.lastPathComponent
            .hasPrefix("kolaleaf-statements-\(vm.fyStartYear)"))
        let contents = try String(contentsOf: url, encoding: .utf8)
        XCTAssertTrue(contents.hasPrefix(
            "Date,Recipient,SendAmount,Status\r\n"))
        XCTAssertTrue(contents.contains("100.00"),
                      "CSV body should include the row sendAmount; contents=\(contents)")
        try? FileManager.default.removeItem(at: dir)
    }

    func test_emptyFY_loadedWithZeroRollup() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            TransfersEndpoints.List.self,
            ListTransfersResponse(transfers: [], nextCursor: nil)
        )
        let now = referenceDate
        let vm = StatementsViewModel(api: api, now: { now })
        await vm.load()

        guard case .loaded(let rollup, let rows) = vm.state else {
            return XCTFail("Expected .loaded")
        }
        XCTAssertEqual(rollup, 0)
        XCTAssertTrue(rows.isEmpty)
    }

    func test_csv_header_andEscapedRows() async {
        let now = referenceDate
        let vm = StatementsViewModel(api: FakeAPIClient(), now: { now })
        let transfer = Transfer(
            id: "t1", userId: "u", recipientId: "r1",
            corridorId: "c", status: .completed,
            sendAmount: Decimal(string: "100.00")!,
            receiveAmount: nil,
            exchangeRate: Decimal(1), fee: 0,
            createdAt: Self.makeDate(year: 2026, month: 5, day: 1)
        )
        // Recipient name contains a comma — must be quoted.
        let recipient = Recipient(
            id: "r1", fullName: "Doe, Jane",
            bankName: "GTBank", bankCode: "058",
            accountNumber: "0123456789"
        )

        let data = vm.csv(for: [transfer], recipientById: ["r1": recipient])
        let csv = String(data: data, encoding: .utf8) ?? ""

        // Iter-2 (N10): line terminator is `\r\n` per RFC 4180 strict.
        XCTAssertTrue(csv.hasPrefix("Date,Recipient,SendAmount,Status\r\n"))
        XCTAssertTrue(csv.contains("\"Doe, Jane\""),
                      "Comma in recipient name must be RFC4180 quoted")
        XCTAssertTrue(csv.contains("100.00"))
        XCTAssertTrue(csv.contains("COMPLETED"))
    }

    func test_load_unauthorized_setsSessionExpired() async {
        let api = FakeAPIClient()
        await api.stageFailure(TransfersEndpoints.List.self, .unauthorized)
        let referenceDate = self.referenceDate
        let vm = StatementsViewModel(api: api, now: { referenceDate })
        await vm.load()
        XCTAssertEqual(vm.state, .sessionExpired)
    }
}
