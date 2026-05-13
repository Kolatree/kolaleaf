// LiveActivityCopyLint.swift  (Phase 10B iter-2 · OO-2001 + CA-2008 + ADV-P10B-C5)
//
// Single source of truth for the "treasury-silent" contract on every
// user-visible Live Activity string. The remittance product is the
// distribution channel; users never see the AUD float / liquidity /
// balance plumbing that funds it.
//
// History: this file used to live in the `KolaleafWidgets` target
// (`KolaleafWidgets/LiveActivityCopyLint.swift`) and a SECOND mirror
// was inlined into `LiveActivityService.swift` so the app target had
// access to the same lint. Phase 10B iter-2 hoists this single file
// into `Kolaleaf/LiveActivities/` and includes it in BOTH the app
// target AND the widget extension target via `project.yml`. The
// widget mirror is deleted; the inline app mirror is deleted.
//
// Release-mode safety (ADV-P10B-C5):
//   The original `assertNotForbidden(_:)` was DEBUG-only — in Release
//   it returned the input verbatim. A user-controllable input
//   (recipient `fullName = "Float Liquidity Holdings Ltd"`) could
//   therefore leak the word "float" onto the lock-screen card with
//   zero enforcement. iter-2 introduces `sanitized(_:)` which
//   redacts forbidden words to `***` in BOTH Debug and Release. The
//   DEBUG `assertionFailure` in `assertNotForbidden(_:)` is preserved
//   so dev builds still trip loudly when copy regresses at the source.
//   Production code paths (label builders) call `sanitized(_:)`.

import Foundation

public enum LiveActivityCopyLint {

    /// Words we never speak to users. Stored lowercased; matching is
    /// case-insensitive and substring-based so "Restoring float", "FLOAT",
    /// and "float-paused" all trip the guard.
    public static let forbidden: Set<String> = [
        "float",
        "treasury",
        "liquidity",
        "insufficient",
        "balance",
    ]

    /// Replacement token for redacted segments in Release builds.
    public static let redaction = "***"

    /// Assert (DEBUG only) that `s` carries none of `forbidden`. Returns
    /// `s` unchanged so the call site can wrap it inline:
    ///
    ///     Text(LiveActivityCopyLint.assertNotForbidden("Catching up — almost there"))
    ///
    /// In Release this is a no-op. Production code paths that
    /// interpolate USER-CONTROLLABLE input (e.g. recipient names)
    /// should call `sanitized(_:)` instead — that is the version
    /// that enforces in Release.
    @discardableResult
    @inlinable
    public static func assertNotForbidden(
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

    /// Release-safe redactor. Returns a string in which any occurrence
    /// of a forbidden word (case-insensitive) is replaced with
    /// `redaction`. In Debug the call also fires `assertionFailure`
    /// via `assertNotForbidden(_:)` so the regression is surfaced at
    /// the source during development.
    ///
    /// Use this on every user-visible string built from inputs that
    /// could plausibly contain a forbidden word — recipient names,
    /// merchant names, anything sourced from a server payload.
    public static func sanitized(_ s: String) -> String {
        // Fire DEBUG assertion first so dev builds still fail at the
        // source, but proceed to scrub in Release so the user-visible
        // surface stays clean.
        _ = assertNotForbidden(s)
        let lower = s.lowercased()
        var out = s
        for word in forbidden where lower.contains(word) {
            // Telemetry breadcrumb — production logs only see the
            // forbidden word once per offending string. No PII (recipient
            // names) is logged; only the lint identifier + word.
            print("[LiveActivityCopyLint] forbidden word '\(word)' redacted in user-visible Live Activity copy")
            out = caseInsensitiveReplace(out, occurrencesOf: word, with: redaction)
        }
        return out
    }

    /// Case-insensitive substring replacement. Foundation's
    /// `replacingOccurrences(of:with:options:.caseInsensitive)` does
    /// the work; wrapping it here keeps the caller single-line.
    private static func caseInsensitiveReplace(
        _ s: String,
        occurrencesOf needle: String,
        with replacement: String
    ) -> String {
        s.replacingOccurrences(
            of: needle,
            with: replacement,
            options: [.caseInsensitive]
        )
    }
}
