// RealLiveActivityAdapterTests.swift  (Phase 10C iter-3 · API-3004 / OO-3002)
//
// Locks the round-trip contract for `RealLiveActivityAdapter.toAK(_:)`
// — the single ActivityKit-bridging point in the service layer. Every
// field on `LiveActivityContent` MUST survive the translation to
// `ActivityContent<KolaleafTransferAttributes.ContentState>`. If a
// future field is added to `LiveActivityContent` and the translator
// isn't updated, this test fails loudly (OO-3002's "future maintenance"
// concern).
//
// CA-2001 exception: this is the ONLY test file that imports
// ActivityKit. The whole point of CA-2001 is that the service surface
// speaks the service-layer DTO so test fakes don't need ActivityKit —
// but the adapter test EXISTS to verify the bridge, which inherently
// touches both sides.

import ActivityKit
import XCTest
@testable import Kolaleaf

@MainActor
final class RealLiveActivityAdapterTests: XCTestCase {

    // MARK: - Fixtures

    private func makeContentState(state: LiveActivityState = .awaitingAUD) -> KolaleafTransferAttributes.ContentState {
        KolaleafTransferAttributes.ContentState(
            state: state,
            etaSeconds: 90,
            lastUpdate: Date(timeIntervalSince1970: 1_780_000_000),
            stageLabel: "Awaiting your AUD"
        )
    }

    // MARK: - staleDate round-trip

    func test_toAK_preservesStaleDate_nil() {
        let dto = LiveActivityContent(state: makeContentState(), staleDate: nil)
        let ak = RealLiveActivityAdapter.toAK(dto)
        XCTAssertNil(ak.staleDate, "nil staleDate must survive the DTO → ActivityKit bridge")
    }

    func test_toAK_preservesStaleDate_concreteDate() throws {
        let staleAt = Date(timeIntervalSince1970: 1_780_900_000)
        let dto = LiveActivityContent(state: makeContentState(), staleDate: staleAt)
        let ak = RealLiveActivityAdapter.toAK(dto)
        let actual = try XCTUnwrap(ak.staleDate)
        XCTAssertEqual(
            actual.timeIntervalSinceReferenceDate,
            staleAt.timeIntervalSinceReferenceDate,
            accuracy: 0.0001,
            "concrete staleDate must round-trip exactly through toAK(_:)"
        )
    }

    // MARK: - ContentState round-trip

    func test_toAK_preservesContentState_state() {
        for band in LiveActivityState.allCases {
            let dto = LiveActivityContent(state: makeContentState(state: band), staleDate: nil)
            let ak = RealLiveActivityAdapter.toAK(dto)
            XCTAssertEqual(ak.state.state, band,
                           "state band must survive the DTO → ActivityKit bridge for \(band)")
        }
    }

    func test_toAK_preservesContentState_etaSeconds_lastUpdate_stageLabel() {
        let dto = LiveActivityContent(state: makeContentState(), staleDate: nil)
        let ak = RealLiveActivityAdapter.toAK(dto)
        XCTAssertEqual(ak.state.etaSeconds, 90)
        XCTAssertEqual(
            ak.state.lastUpdate.timeIntervalSinceReferenceDate,
            Date(timeIntervalSince1970: 1_780_000_000).timeIntervalSinceReferenceDate,
            accuracy: 0.0001
        )
        XCTAssertEqual(ak.state.stageLabel, "Awaiting your AUD")
    }
}
