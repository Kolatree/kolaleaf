// CopyLintTests.swift  (Phase 10A iter-2 · OO-1001 + ADV-P10A-C3)
//
// Pins the treasury-silent contract on every headline the Live
// Activity surfaces emit. The forbidden-word list is the source of
// truth (`LiveActivityCopyLint.forbidden`); these tests assert that
// `LiveActivityStyle.descriptor(...).headline` never trips the guard
// for any `LiveActivityState` case + a representative recipient name.

import XCTest

@MainActor
final class CopyLintTests: XCTestCase {

    private static let recipient = "Folasade"

    func test_descriptor_headlines_areTreasurySilent() {
        for state in LiveActivityState.allCases {
            let desc = LiveActivityStyle.descriptor(for: state, recipientName: Self.recipient)
            let lower = desc.headline.lowercased()
            for word in LiveActivityCopyLint.forbidden {
                XCTAssertFalse(
                    lower.contains(word),
                    "\(state) headline leaks forbidden vocabulary '\(word)': \(desc.headline)"
                )
            }
        }
    }

    /// The lint helper itself must catch every forbidden word. We can't
    /// hit `assertionFailure` in a release-style test, so we only check
    /// the pass-through identity path here — the `#if DEBUG` halt is
    /// exercised by an XCTest crash gate during local dev.
    func test_assertNotForbidden_returnsInputUnchanged_forSafeStrings() {
        let safe = "Sending to \(Self.recipient)"
        XCTAssertEqual(LiveActivityCopyLint.assertNotForbidden(safe), safe)
    }

    /// Even if a downstream caller forgets to pipe through the
    /// `LiveActivityCopyLint.assertNotForbidden(_:)` helper, the
    /// `floatPaused` headline must remain user-safe.
    func test_floatPaused_headline_doesNotContainWordFloat() {
        let desc = LiveActivityStyle.descriptor(for: .floatPaused, recipientName: Self.recipient)
        XCTAssertFalse(desc.headline.lowercased().contains("float"))
    }
}
