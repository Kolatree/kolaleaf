// DynamicIslandCompactSnapshotTests.swift  (Phase 10A · U67)
// Snapshots the leading + trailing compact Dynamic Island regions
// across the four user-visible state bands.
//
// Compact region = 162pt total (system splits between leading &
// trailing); we render leading and trailing side-by-side at their
// individual widths so a single snapshot covers both halves.

import XCTest
import SwiftUI
// Widget sources are compiled into this test bundle directly (see project.yml).

@MainActor
final class DynamicIslandCompactSnapshotTests: WidgetSnapshotTestCase {

    /// Fixed at 5 minutes after the preview's `lastUpdate`
    /// (1_700_000_000) so the trailing trailing badge is deterministic.
    private let fixedNow = Date(timeIntervalSince1970: 1_700_000_300)

    // MARK: - Helpers

    private func compactPair(
        state: LiveActivityState,
        etaSeconds: Int,
        stageLabel: String
    ) -> some View {
        let view = DynamicIslandCompact(
            attributes: .preview,
            state: .preview(state: state, etaSeconds: etaSeconds, stageLabel: stageLabel),
            now: fixedNow
        )
        return HStack(spacing: 0) {
            view.leading
            Spacer(minLength: 0)
            view.trailing
        }
        .padding(.horizontal, 4)
        .background(Color.black) // mimic DI background
    }

    // MARK: - Tests

    func test_compact_awaitingAUD() {
        let v = compactPair(state: .awaitingAUD, etaSeconds: 23 * 60, stageLabel: "Awaiting your AUD")
        assertWidgetSnapshot(of: v, size: CGSize(width: 162, height: 36))
    }

    func test_compact_processingNGN() {
        let v = compactPair(state: .processingNGN, etaSeconds: 4 * 60, stageLabel: "Sending NGN")
        assertWidgetSnapshot(of: v, size: CGSize(width: 162, height: 36))
    }

    func test_compact_completed() {
        let v = compactPair(state: .completed, etaSeconds: 0, stageLabel: "Done")
        assertWidgetSnapshot(of: v, size: CGSize(width: 162, height: 36))
    }

    func test_compact_floatPaused() {
        // ADV-P10A-C3: treasury-silent stage label.
        let v = compactPair(state: .floatPaused, etaSeconds: 4 * 60, stageLabel: "Catching up")
        assertWidgetSnapshot(of: v, size: CGSize(width: 162, height: 36))
    }
}
