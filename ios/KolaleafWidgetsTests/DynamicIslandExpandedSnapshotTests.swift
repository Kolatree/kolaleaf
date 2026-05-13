// DynamicIslandExpandedSnapshotTests.swift  (Phase 10A · U68)
// Snapshots the long-press expanded Dynamic Island composition.

import XCTest
import SwiftUI
// Widget sources are compiled into this test bundle directly (see project.yml).

@MainActor
final class DynamicIslandExpandedSnapshotTests: WidgetSnapshotTestCase {

    /// Fixed at 5 minutes after the preview's `lastUpdate`
    /// (1_700_000_000) so the elapsed badge is deterministic.
    private let fixedNow = Date(timeIntervalSince1970: 1_700_000_300)

    private func expandedComposed(
        state: LiveActivityState,
        etaSeconds: Int,
        stageLabel: String
    ) -> some View {
        let view = DynamicIslandExpanded(
            attributes: .preview,
            state: .preview(state: state, etaSeconds: etaSeconds, stageLabel: stageLabel),
            now: fixedNow
        )
        // The DSL splits the composition into leading / trailing / bottom
        // regions. For a snapshot we recompose them in the layout the OS
        // uses: leading + trailing on a top row, bottom underneath.
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                view.leadingRegion
                Spacer(minLength: 12)
                view.trailingRegion
            }
            view.bottomRegion
        }
        .padding(12)
        .background(Color.black)
        .foregroundColor(.white)
    }

    func test_expanded_awaitingAUD() {
        let v = expandedComposed(state: .awaitingAUD, etaSeconds: 23 * 60, stageLabel: "Awaiting your AUD")
        assertWidgetSnapshot(of: v, size: CGSize(width: 360, height: 200))
    }

    func test_expanded_processingNGN() {
        let v = expandedComposed(state: .processingNGN, etaSeconds: 4 * 60, stageLabel: "Sending NGN to GTBank")
        assertWidgetSnapshot(of: v, size: CGSize(width: 360, height: 200))
    }

    func test_expanded_completed() {
        let v = expandedComposed(state: .completed, etaSeconds: 0, stageLabel: "Delivered")
        assertWidgetSnapshot(of: v, size: CGSize(width: 360, height: 200))
    }

    func test_expanded_floatPaused() {
        // ADV-P10A-C3: treasury-silent stage label.
        let v = expandedComposed(state: .floatPaused, etaSeconds: 4 * 60, stageLabel: "Hold tight — we'll resume shortly")
        assertWidgetSnapshot(of: v, size: CGSize(width: 360, height: 200))
    }
}
