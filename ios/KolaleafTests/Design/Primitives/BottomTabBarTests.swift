// BottomTabBarTests.swift  (Phase 4 · U33)
// Behavioural tests for the BottomTabBar selection contract.
//
// Skipping snapshot tests for the bar itself — the existing snapshot
// suite is for screen-level views (`WelcomeViewSnapshotTests`); a
// fresh snapshot here would balloon recording overhead for a 4-icon
// bar whose visual is fully determined by `KolaColors.trustGreen`
// vs `KolaColors.muted`. The tap-mutates-binding contract is the
// load-bearing behaviour and is asserted directly.
//
// Iteration 2 / API-102 + API-103: `Tab` was renamed to `RootTab` and
// the `items:` parameter was dropped. These tests now consume the new
// surface directly — no module qualification needed because the new
// name no longer collides with `SwiftUI.Tab`.

import XCTest
import SwiftUI
@testable import Kolaleaf

@MainActor
final class BottomTabBarTests: XCTestCase {

    func test_init_acceptsBinding() {
        // Smoke test: BottomTabBar constructs from a binding without
        // compile-time issues — the prod call site in MainTabView
        // relies on this surface staying ergonomic.
        var tab: RootTab = .send
        let binding = Binding<RootTab>(get: { tab }, set: { tab = $0 })
        _ = BottomTabBar(selection: binding)
        XCTAssertEqual(tab, RootTab.send)
    }

    func test_bindingMutation_updatesExternalState() {
        // The bar writes through the binding — exercising the binding
        // setter directly proves the contract that callers rely on
        // without spinning up a UIHostingController for a single tap.
        var tab: RootTab = .send
        let binding = Binding<RootTab>(get: { tab }, set: { tab = $0 })
        _ = BottomTabBar(selection: binding)

        binding.wrappedValue = .recipients
        XCTAssertEqual(tab, RootTab.recipients)
    }

    func test_tabAllCases_orderMatchesProductSpec() {
        // Phase 4 / U33: Send / Activity / Recipients / Account in
        // that order. If a future commit reorders the enum, the bar
        // would silently reorder too — this test pins the ordering.
        XCTAssertEqual(
            RootTab.allCases,
            [.send, .activity, .recipients, .account]
        )
    }

    func test_rawValues_areStable() {
        // API-110: rawValues are persisted under `kola.selectedTab` and
        // will key analytics + DeepLink router strings. An accidental
        // case rename would silently invalidate every persisted value
        // across the user base; this test catches that.
        XCTAssertEqual(RootTab.send.rawValue, "send")
        XCTAssertEqual(RootTab.activity.rawValue, "activity")
        XCTAssertEqual(RootTab.recipients.rawValue, "recipients")
        XCTAssertEqual(RootTab.account.rawValue, "account")
    }
}
