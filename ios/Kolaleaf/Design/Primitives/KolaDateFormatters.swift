// KolaDateFormatters.swift  (Phase 8 iter-2 · N18)
// Shared DateFormatter instances pinned to Australia/Sydney.
//
// Phase 8 iter-1 duplicated the same `DateFormatter` configuration
// across ActivityTabView, StatementsViewModel, and ReceiptView. Each
// site re-created the formatter on every body invocation AND each one
// silently used the device-local timezone — which means a user
// roaming through PST saw FY boundaries and month rollups shifted by
// 14+ hours.
//
// This file is the single source of truth:
//   • `monthDay`     — "May 12"            (Activity row timestamps)
//   • `csvDate`      — "2026-05-12"        (RFC 4180 export rows)
//   • `monthYear`    — "May 2026"          (Statements monthly row label)
//
// All three pin to `Australia/Sydney` so tax/audit dates do not drift
// when the device clock disagrees with where the user banks. Locale
// stays `en_AU` to match the rest of the app.
//
// Why static let?
//   • DateFormatter construction is expensive (~1ms each); reusing a
//     single instance is the documented Apple recommendation.
//   • `let` at file scope is implicitly concurrency-safe under Swift 6
//     when the closure references no mutable state, and
//     `DateFormatter` itself is `@unchecked Sendable` per Foundation.

import Foundation

public enum KolaDateFormatters {

    /// "May 12" — short month + day, used by Activity row timestamps.
    public static let monthDay: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "LLL d"
        f.locale = Locale(identifier: "en_AU")
        f.timeZone = TimeZone(identifier: "Australia/Sydney")
        return f
    }()

    /// "2026-05-12" — ISO-style yyyy-MM-dd used by CSV exports.
    /// RFC 4180 doesn't dictate the date format but Australian tax
    /// tooling expects ISO calendar dates.
    public static let csvDate: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_AU")
        f.timeZone = TimeZone(identifier: "Australia/Sydney")
        return f
    }()

    /// "May 2026" — long month + year, used by Statements monthly rows.
    public static let monthYear: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "LLLL yyyy"
        f.locale = Locale(identifier: "en_AU")
        f.timeZone = TimeZone(identifier: "Australia/Sydney")
        return f
    }()
}
