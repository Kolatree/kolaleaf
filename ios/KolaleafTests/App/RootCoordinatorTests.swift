// RootCoordinatorTests.swift  (Phase 1 · U15)
// The view itself relies on SwiftUI scene plumbing, so we test the pure
// `RootRouter.route` decision matrix instead. This is the same matrix the
// view body runs through.

import XCTest
@testable import Kolaleaf

final class RootRouterTests: XCTestCase {

    func test_noSession_routesToOnboardingWelcome() {
        let r = RootRouter.route(hasActiveSession: false, kycStatus: .unknown)
        XCTAssertEqual(r, .onboardingWelcome)
    }

    func test_noSession_overridesAnyKYCStatus() {
        for status: KycStatus in [.unknown, .notStarted, .processing, .approved, .underReview, .softRejected, .hardRejected] {
            XCTAssertEqual(
                RootRouter.route(hasActiveSession: false, kycStatus: status),
                .onboardingWelcome,
                "no session should always route to onboardingWelcome (failed for \(status))"
            )
        }
    }

    func test_session_kycApproved_routesToMainTab() {
        let r = RootRouter.route(hasActiveSession: true, kycStatus: .approved)
        XCTAssertEqual(r, .mainTab)
    }

    func test_session_kycUnderReview_routesToKYCUnderReview() {
        let r = RootRouter.route(hasActiveSession: true, kycStatus: .underReview)
        XCTAssertEqual(r, .kycUnderReview)
    }

    func test_session_kycPendingStates_routeToOnboardingResumeAtKYC() {
        for status: KycStatus in [.unknown, .notStarted, .processing, .softRejected, .hardRejected] {
            XCTAssertEqual(
                RootRouter.route(hasActiveSession: true, kycStatus: status),
                .onboardingResumeAtKYC,
                "pending kyc state \(status) should route to onboardingResumeAtKYC"
            )
        }
    }
}
