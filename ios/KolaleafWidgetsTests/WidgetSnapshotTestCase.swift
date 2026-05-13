// WidgetSnapshotTestCase.swift  (Phase 10A · U67-U69)
// Base class for Live Activity snapshot tests. Live Activity views render
// at fixed widths (DI compact/expanded + lock-screen card), so each test
// supplies its own size — no global iPhone-15-Pro frame here.
//
// ADV-P10A-W10 (iter-2): precision tightened to 0.99 / 0.98 after the
// elapsed-badge `now` injection made the surfaces deterministic. Below
// these thresholds genuine regressions slip through silently.

import XCTest
import SwiftUI
import SnapshotTesting

@MainActor
open class WidgetSnapshotTestCase: XCTestCase {
    open var recordOverride: Bool { false }

    private var shouldRecord: Bool {
        ProcessInfo.processInfo.environment["KOLA_RECORD_SNAPSHOTS"] == "1" || recordOverride
    }

    /// Snapshot a SwiftUI view sized to a fixed CGSize. The view is wrapped
    /// in a UIHostingController so SnapshotTesting's image strategy can
    /// render it through the real UIKit layer (Inter font + Asset catalog
    /// colours resolve correctly).
    public func assertWidgetSnapshot<V: View>(
        of view: V,
        size: CGSize,
        named name: String? = nil,
        file: StaticString = #file,
        testName: String = #function,
        line: UInt = #line
    ) {
        let host = UIHostingController(rootView: view.frame(width: size.width, height: size.height))
        host.view.frame = CGRect(origin: .zero, size: size)
        host.view.backgroundColor = .clear

        let record: SnapshotTestingConfiguration.Record = shouldRecord ? .all : .missing
        withSnapshotTesting(record: record) {
            SnapshotTesting.assertSnapshot(
                of: host,
                as: .image(precision: 0.99, perceptualPrecision: 0.98, size: size),
                named: name,
                file: file,
                testName: testName,
                line: line
            )
        }
    }
}
