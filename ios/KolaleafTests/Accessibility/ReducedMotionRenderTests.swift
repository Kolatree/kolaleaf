// ReducedMotionRenderTests.swift  (Phase 12 · U80)
// Smoke-test representative animated screens and lock the reduced-motion
// hardening against raw fade-animation regressions.

import SwiftUI
import XCTest
@testable import Kolaleaf

@MainActor
final class ReducedMotionRenderTests: XCTestCase {

    func test_emailEntry_renders() {
        let view = EmailEntryView(
            vm: EmailEntryViewModel(api: FakeAPIClient(), onCodeSent: { _ in })
        )

        assertRenders(view)
    }

    func test_kycUnderReview_renders() {
        let view = KYCUnderReviewView(
            onNotifyMe: {},
            onTalkToSupport: {}
        )

        assertRenders(view)
    }

    func test_motionCallSites_areReduceMotionAware() throws {
        let sourceRoot = try sourceRootURL()
        let paths = [
            "App/KolaleafApp.swift",
            "Features/KYC/KYCProcessingView.swift",
            "Features/KYC/KYCUnderReviewView.swift",
            "Features/Onboarding/EmailEntryView.swift",
            "Features/Onboarding/EmailOTPView.swift",
            "Features/Onboarding/PhoneEntryView.swift",
            "Features/Onboarding/PhoneOTPView.swift",
            "Features/Onboarding/RegistrationDetailsView.swift",
            "Features/Onboarding/SignInView.swift",
            "Features/Refer/ReferView.swift",
            "Features/Statements/StatementsView.swift",
        ]

        for path in paths {
            let text = try String(contentsOf: sourceRoot.appendingPathComponent(path))
            XCTAssertFalse(text.contains("KolaMotion.softFade"), path)
            XCTAssertFalse(text.contains("withAnimation {"), path)
        }

        let kycProcessing = try String(
            contentsOf: sourceRoot.appendingPathComponent("Features/KYC/KYCProcessingView.swift")
        )
        XCTAssertTrue(kycProcessing.contains("guard !reduceMotion else"), "KYC spinner must stop under Reduce Motion")
    }

    private func assertRenders<V: View>(
        _ view: V,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let hosted = view
            .environment(\.dynamicTypeSize, .accessibility3)
            .frame(width: 393, height: 852)

        let controller = UIHostingController(rootView: hosted)
        controller.view.frame = CGRect(x: 0, y: 0, width: 393, height: 852)
        controller.loadViewIfNeeded()
        controller.view.setNeedsLayout()
        controller.view.layoutIfNeeded()

        XCTAssertEqual(controller.view.bounds.size.width, 393, file: file, line: line)
        XCTAssertEqual(controller.view.bounds.size.height, 852, file: file, line: line)
    }

    private func sourceRootURL() throws -> URL {
        var url = URL(fileURLWithPath: #filePath)
        while url.path != "/" {
            let candidate = url
                .deletingLastPathComponent()
                .appendingPathComponent("Kolaleaf/App/KolaleafApp.swift")
            if FileManager.default.fileExists(atPath: candidate.path) {
                return candidate
                    .deletingLastPathComponent()
                    .deletingLastPathComponent()
            }
            url.deleteLastPathComponent()
        }
        throw XCTSkip("Unable to locate Kolaleaf source root from #filePath")
    }
}
