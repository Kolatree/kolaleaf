// TransferLiveActivityWiringTests.swift  (Phase 10A iter-2 · CA-1002)
//
// Smoke test that the widget bundle's `TransferLiveActivity` body
// compiles + composes without trapping. Catches the regression class
// where a `DynamicIslandExpandedRegion` initialiser is missing or the
// `ActivityConfiguration` DSL is mis-wired — neither shows up at
// build time but both crash at runtime.

import XCTest
import SwiftUI

@MainActor
final class TransferLiveActivityWiringTests: XCTestCase {
    func test_transferLiveActivity_bodyCompiles() {
        // Holds the configuration as an opaque value, but more
        // importantly forces the @WidgetConfigurationBuilder body
        // through the type checker once per build.
        _ = TransferLiveActivity().body
    }
}
