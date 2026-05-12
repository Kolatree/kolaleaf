// StatementsViewModel.swift  (Phase 8 · U59 — iter-2 fixes M1/M2/M3/A4/N10/N18)
// Drives the Statements & Tax screen (Screen 30).
//
// TODO(backend): no `/account/statements` endpoint exists. Until the
// backend ships one, the VM synthesises the rollup client-side from
// the existing /transfers list:
//   • FY rollup: sum of `sendAmount` over transfers in the AU FY
//     window (1 July → 30 June).
//   • Monthly rows: aggregate by month within the FY.
//   • CSV synthesis: built from the same transfer list. Header row
//     + `Date,Recipient,SendAmount,Status`.
//
// Iter-2 (M1): all calendar math is pinned to Australia/Sydney so the
// FY window doesn't shift by 14 hours on a device in PST. Tax filing
// is anchored to AEST/AEDT regardless of where the user roams.
//
// Iter-2 (M2): aggregation includes ONLY terminal-success transfers
// (`.completed`). NGN_SENT is in-flight (cf. Transfer state machine);
// REFUNDED / CANCELLED / EXPIRED / FAILED money never left the user's
// wallet net of refund. Counting them in a tax rollup is wrong — the
// ATO needs gross sent that completed.
//
// Iter-2 (M3): bucketing uses `completedAt ?? createdAt`. Money-movement
// date is what matters for the financial year. A transfer initiated
// at 23:59 on 30 June that completes 00:01 on 1 July belongs in the
// new FY, not the old one.
//
// PDF download is not supported in this phase — the backend doesn't
// emit one yet. The View surfaces a toast ("PDF available shortly")
// and flags the absence to the user.

import Foundation
import Observation

@MainActor
@Observable
public final class StatementsViewModel {

    public struct MonthlyRow: Equatable, Identifiable, Sendable {
        /// `id = "<year>-<month>"` so SwiftUI ForEach is stable.
        public let id: String
        public let year: Int
        public let month: Int
        public let total: Decimal
        public let transferCount: Int

        public init(id: String, year: Int, month: Int,
                    total: Decimal, transferCount: Int) {
            self.id = id
            self.year = year
            self.month = month
            self.total = total
            self.transferCount = transferCount
        }

        /// "May 2026" — locale-aware month label.
        public var displayName: String {
            var components = DateComponents()
            components.year = year
            components.month = month
            guard let date = StatementsViewModel.auCalendar.date(from: components) else {
                return "\(month)/\(year)"
            }
            return KolaDateFormatters.monthYear.string(from: date)
        }
    }

    public enum State: Equatable {
        case idle
        case loading
        case loaded(rollup: Decimal, rows: [MonthlyRow])
        case sessionExpired
        case failed(String)
    }

    public private(set) var state: State = .idle
    /// Australia FY anchor — for the period 1 July of `fyStartYear` to
    /// 30 June of `fyStartYear+1`. The View renders this as
    /// "FY \(fyStartYear)–\(fyStartYear+1)".
    public private(set) var fyStartYear: Int

    /// Iter-2 (A4): retained on the VM so the View can build the
    /// CSV share sheet without round-tripping through the API again.
    /// Populated by `load()` (the Domain-bridged subset of transfers
    /// the aggregate consumed) and `recipientById` resolves names.
    public private(set) var transfers: [Transfer] = []
    public private(set) var recipientById: [String: Recipient] = [:]

    private let api: AuthAPI
    private let now: @Sendable () -> Date

    /// Iter-2 (M1): every Calendar/DateComponents/DateFormatter that
    /// participates in FY bucketing is pinned to Australia/Sydney.
    /// Module-private so other VMs that need the same anchor can
    /// import it once.
    nonisolated static let auCalendar: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Australia/Sydney")!
        return cal
    }()

    /// `now` is injected so tests can pin the FY window deterministically.
    public init(
        api: AuthAPI,
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.api = api
        self.now = now
        self.fyStartYear = Self.computeFYStartYear(reference: now())
    }

    public func load() async {
        state = .loading
        // Pull a reasonable page — the AU FY contains at most 12
        // monthly buckets and the average user makes <100 transfers
        // a year. We don't paginate at v1; pagination lands when the
        // backend ships `/account/statements`.
        let result = await api.send(TransfersEndpoints.List(
            status: nil, limit: 100, cursor: nil
        ))
        switch result {
        case .success(let response):
            // Domain bridge so malformed money fields are noisy, not
            // silent zero.
            let domain = response.transfers.compactMap { shape in
                try? shape.toDomain()
            }
            self.transfers = domain
            let (rollup, rows) = aggregate(transfers: domain)
            state = .loaded(rollup: rollup, rows: rows)
            // Fire-and-forget recipient hydration — the rollup screen
            // doesn't block on it, but the CSV share later wants
            // recipient names.
            await hydrateRecipients(for: domain)
        case .failure(let err):
            switch err {
            case .unauthorized:
                state = .sessionExpired
            default:
                state = .failed(err.errorDescription
                                ?? "Couldn't load statements.")
            }
        }
    }

    /// Bump the FY anchor backward or forward by one year and reload.
    /// The View wires this to prev/next buttons.
    public func shiftFY(by delta: Int) async {
        fyStartYear += delta
        await load()
    }

    /// CSV synthesis. Returns a Data blob the View can write to a
    /// temp file before presenting `UIActivityViewController`.
    ///
    /// Iter-2 (N10): line terminator is `\r\n` per RFC 4180 strict.
    public func csv(for transfers: [Transfer], recipientById: [String: Recipient]) -> Data {
        let header = "Date,Recipient,SendAmount,Status\r\n"
        let rows: [String] = transfers.compactMap { transfer -> String? in
            let bucketDate = transfer.completedAt ?? transfer.createdAt
            guard let date = bucketDate else { return nil }
            let recipientName = recipientById[transfer.recipientId]?.fullName
                ?? transfer.recipientId
            let dateStr = KolaDateFormatters.csvDate.string(from: date)
            // Escape quotes / commas in the recipient name per
            // RFC 4180 (very basic — wrap fields with quotes when
            // they contain a comma or a quote).
            let escapedName = Self.csvEscape(recipientName)
            return "\(dateStr),\(escapedName),\(transfer.sendAmount.wireMoneyString),\(transfer.status.rawValue)"
        }
        let body = rows.joined(separator: "\r\n")
        // Trailing CRLF so consumers that split-on-newline see a clean
        // last row (RFC 4180 §2.2 allows but doesn't require it).
        return Data((header + body + (body.isEmpty ? "" : "\r\n")).utf8)
    }

    /// Iter-2 (A4): convenience that writes the CSV to a temp file
    /// and returns its URL so the View can hand it to
    /// `UIActivityViewController`. Test seam: callers can pass
    /// a directory for isolation.
    @discardableResult
    public func csvFileURL(
        directory: URL = FileManager.default.temporaryDirectory
    ) throws -> URL {
        let data = csv(for: transfers, recipientById: recipientById)
        let url = directory.appendingPathComponent(
            "kolaleaf-statements-\(fyStartYear).csv"
        )
        try data.write(to: url, options: .atomic)
        return url
    }

    // MARK: - FY window helpers

    /// The AU financial year start year for a given reference date.
    /// July → December: FY starts in `year`. January → June: FY
    /// started in `year - 1`.
    ///
    /// Iter-2 (M1): components extracted under Australia/Sydney.
    public static func computeFYStartYear(reference: Date) -> Int {
        let comps = auCalendar.dateComponents(
            [.year, .month], from: reference
        )
        let year = comps.year ?? 2026
        let month = comps.month ?? 1
        return month >= 7 ? year : year - 1
    }

    /// FY window for `fyStartYear` — [1 Jul start, 1 Jul next year).
    ///
    /// Iter-2 (M1): start/end resolved in Australia/Sydney so a
    /// device in PST treats 1 July 2025 00:00 AEST as the boundary
    /// regardless of local clock skew.
    public var fyWindow: (start: Date, end: Date) {
        var startComps = DateComponents()
        startComps.year = fyStartYear
        startComps.month = 7
        startComps.day = 1
        startComps.timeZone = Self.auCalendar.timeZone
        let start = Self.auCalendar.date(from: startComps) ?? Date.distantPast
        var endComps = DateComponents()
        endComps.year = fyStartYear + 1
        endComps.month = 7
        endComps.day = 1
        endComps.timeZone = Self.auCalendar.timeZone
        let end = Self.auCalendar.date(from: endComps) ?? Date.distantFuture
        return (start, end)
    }

    // MARK: - Aggregation

    /// Iter-2 (M2/M3): bucketing inputs.
    ///   • Filter to `.completed` — terminal-success only. Tax rollup
    ///     must reflect dollars that actually left the user's wallet
    ///     and arrived. NGN_SENT is in-flight; refund/fail/expire/
    ///     cancel are not money-out events.
    ///   • Bucket by `completedAt ?? createdAt` so a transfer that
    ///     STRADDLES the FY boundary lands in the FY when funds
    ///     actually moved, not when the user tapped send.
    private func aggregate(transfers: [Transfer]) -> (Decimal, [MonthlyRow]) {
        let (start, end) = fyWindow
        let terminalSuccess = transfers.filter { $0.status == .completed }
        let inFY = terminalSuccess.filter { transfer in
            guard let bucketDate = transfer.completedAt ?? transfer.createdAt else {
                return false
            }
            return bucketDate >= start && bucketDate < end
        }
        let rollup = inFY.reduce(Decimal(0)) { $0 + $1.sendAmount }

        // Bucket by (year, month) under Australia/Sydney so December
        // 31 in NSW renders December even if the device clock says
        // 8am Jan 1 in UTC.
        var bucket: [String: (year: Int, month: Int,
                              total: Decimal, count: Int)] = [:]
        for transfer in inFY {
            guard let bucketDate = transfer.completedAt ?? transfer.createdAt else {
                continue
            }
            let comps = Self.auCalendar.dateComponents([.year, .month], from: bucketDate)
            guard let y = comps.year, let m = comps.month else { continue }
            let key = "\(y)-\(m)"
            if var existing = bucket[key] {
                existing.total += transfer.sendAmount
                existing.count += 1
                bucket[key] = existing
            } else {
                bucket[key] = (y, m, transfer.sendAmount, 1)
            }
        }
        let rows = bucket
            .map { (key, value) in
                MonthlyRow(id: key, year: value.year, month: value.month,
                           total: value.total, transferCount: value.count)
            }
            .sorted { lhs, rhs in
                if lhs.year != rhs.year { return lhs.year > rhs.year }
                return lhs.month > rhs.month
            }
        return (rollup, rows)
    }

    /// Iter-2 (A4): pull recipient names for the recipient ids we
    /// just rolled up. Best-effort — failure leaves `recipientById`
    /// untouched so CSV falls back to the recipient id string.
    private func hydrateRecipients(for transfers: [Transfer]) async {
        guard !transfers.isEmpty else { return }
        let result = await api.send(RecipientsEndpoints.List())
        if case .success(let response) = result {
            var map: [String: Recipient] = [:]
            for r in response.recipients { map[r.id] = r }
            self.recipientById = map
        }
    }

    // MARK: - CSV helpers

    private static func csvEscape(_ value: String) -> String {
        if value.contains(",") || value.contains("\"") || value.contains("\n") {
            let escaped = value.replacingOccurrences(of: "\"", with: "\"\"")
            return "\"\(escaped)\""
        }
        return value
    }
}
