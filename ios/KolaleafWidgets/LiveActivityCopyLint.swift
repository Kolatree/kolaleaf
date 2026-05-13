// LiveActivityCopyLint.swift  (Phase 10A iter-2 · OO-1001 + ADV-P10A-C3)
// DEBUG-only guard against treasury-internal vocabulary leaking into
// user-visible Live Activity copy. The remittance product is the
// distribution channel; users never see the AUD float / liquidity /
// balance plumbing that funds it.
//
// In Release builds every entry point compiles to a no-op so the
// runtime cost is zero. In DEBUG every user-visible string a widget
// surface emits should pass through `assertNotForbidden(_:)` and any
// snuck-in word fires `assertionFailure` immediately so the snapshot
// suite catches the regression at the source, not after a screenshot
// review.

import Foundation

enum LiveActivityCopyLint {

    /// Words we never speak to users. Stored lowercased; matching is
    /// case-insensitive and substring-based so "Restoring float", "FLOAT",
    /// and "float-paused" all trip the guard.
    static let forbidden: Set<String> = [
        "float",
        "treasury",
        "liquidity",
        "insufficient",
        "balance",
    ]

    /// Assert (DEBUG only) that `s` carries none of `forbidden`. Returns
    /// `s` unchanged so the call site can wrap it inline:
    ///
    ///     Text(LiveActivityCopyLint.assertNotForbidden("Catching up — almost there"))
    ///
    /// In Release this is `@inlinable` and the call disappears.
    @discardableResult
    @inlinable
    static func assertNotForbidden(
        _ s: String,
        file: StaticString = #file,
        line: UInt = #line
    ) -> String {
        #if DEBUG
        let lower = s.lowercased()
        for word in forbidden where lower.contains(word) {
            assertionFailure(
                "Live Activity copy contains forbidden treasury vocabulary: \"\(word)\" in \"\(s)\"",
                file: file,
                line: line
            )
            break
        }
        #endif
        return s
    }
}
