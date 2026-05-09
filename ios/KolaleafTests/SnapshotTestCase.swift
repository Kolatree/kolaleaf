// SnapshotTestCase.swift  (Phase 0 · U14)
// Base XCTestCase for Point-Free swift-snapshot-testing assertions.
//
// Reference dimensions: iPhone 15 Pro physical resolution 1179×2556 (3× of 393×852pt logical).
// r1 used 1170×2532 — that is iPhone 15 (non-Pro), corrected in r2.
//
// Precision: 0.97 / perceptualPrecision 0.97 — tighter than default but loose enough to
// survive cross-host font-rendering differences (Mac vs Xcode Cloud).

import XCTest
import SnapshotTesting
import SwiftUI

open class SnapshotTestCase: XCTestCase {
    /// Set to true to overwrite reference snapshots. Always commit with this back at false.
    open var recordOverride: Bool { false }

    override open func setUp() {
        super.setUp()
        // Honor a global env override for CI.
        if ProcessInfo.processInfo.environment["KOLA_RECORD_SNAPSHOTS"] == "1" {
            isRecording = true
        } else {
            isRecording = recordOverride
        }
    }

    /// Snapshot a SwiftUI view at iPhone 15 Pro physical resolution.
    /// Uses `.image(layout: .device(config: .iPhone15Pro))` once we've defined that config;
    /// for now we use explicit pixel dimensions.
    public func assertSnapshot<V: View>(of view: V,
                                        named name: String? = nil,
                                        file: StaticString = #file,
                                        testName: String = #function,
                                        line: UInt = #line) {
        let host = UIHostingController(rootView: view)
        host.view.frame = CGRect(x: 0, y: 0, width: 393, height: 852)

        SnapshotTesting.assertSnapshot(
            of: host,
            as: .image(precision: 0.97, perceptualPrecision: 0.97,
                       size: CGSize(width: 393, height: 852)),
            named: name,
            file: file,
            testName: testName,
            line: line
        )
    }
}
