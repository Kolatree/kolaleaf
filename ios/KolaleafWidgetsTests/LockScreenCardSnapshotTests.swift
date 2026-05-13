// LockScreenCardSnapshotTests.swift  (Phase 10A · U69)
// Snapshots the full lock-screen / banner Live Activity card across
// the user-visible state bands.
//
// iter-2 (ADV-P10A-C6): `now` is fixed at 5 minutes after the
// preview's `lastUpdate` so the elapsed badge renders "5m"
// deterministically across runs.
// iter-2 (ADV-P10A-C3): the floatPaused fixture stage label is
// treasury-silent — no "float" / "balance" leakage.

import XCTest
import SwiftUI
// Widget sources are compiled into this test bundle directly (see project.yml).

@MainActor
final class LockScreenCardSnapshotTests: WidgetSnapshotTestCase {

    /// 5 minutes after `KolaleafTransferAttributes.ContentState.preview`'s
    /// `lastUpdate` (1_700_000_000). Holds the elapsed badge at "5m".
    private let fixedNow = Date(timeIntervalSince1970: 1_700_000_300)

    private func card(
        state: LiveActivityState,
        etaSeconds: Int,
        stageLabel: String
    ) -> some View {
        LockScreenCard(
            attributes: .preview,
            state: .preview(state: state, etaSeconds: etaSeconds, stageLabel: stageLabel),
            now: fixedNow
        )
    }

    func test_lockScreenCard_awaitingAUD() {
        let v = card(state: .awaitingAUD, etaSeconds: 23 * 60, stageLabel: "Awaiting your AUD")
        assertWidgetSnapshot(of: v, size: CGSize(width: 360, height: 160))
    }

    func test_lockScreenCard_processingNGN() {
        let v = card(state: .processingNGN, etaSeconds: 4 * 60, stageLabel: "Sending NGN to GTBank")
        assertWidgetSnapshot(of: v, size: CGSize(width: 360, height: 160))
    }

    func test_lockScreenCard_completed() {
        let v = card(state: .completed, etaSeconds: 0, stageLabel: "Delivered")
        assertWidgetSnapshot(of: v, size: CGSize(width: 360, height: 160))
    }

    func test_lockScreenCard_floatPaused() {
        // ADV-P10A-C3: treasury-silent stage label.
        let v = card(state: .floatPaused, etaSeconds: 4 * 60, stageLabel: "Hold tight — we'll resume shortly")
        assertWidgetSnapshot(of: v, size: CGSize(width: 360, height: 160))
    }
}
