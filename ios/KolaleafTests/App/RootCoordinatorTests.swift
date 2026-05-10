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
        for status: KycStatus in [.unknown, .pending, .inReview, .verified, .rejected] {
            XCTAssertEqual(
                RootRouter.route(hasActiveSession: false, kycStatus: status),
                .onboardingWelcome,
                "no session should always route to onboardingWelcome (failed for \(status))"
            )
        }
    }

    func test_session_kycVerified_routesToMainTab() {
        let r = RootRouter.route(hasActiveSession: true, kycStatus: .verified)
        XCTAssertEqual(r, .mainTab)
    }

    func test_session_kycInReview_routesToKYCUnderReview() {
        let r = RootRouter.route(hasActiveSession: true, kycStatus: .inReview)
        XCTAssertEqual(r, .kycUnderReview)
    }

    func test_session_kycResumeStates_routeToOnboardingResumeAtKYC() {
        // Phase 2 contract-drift fix: backend's KycStatus enum is
        // `PENDING | IN_REVIEW | VERIFIED | REJECTED`. .pending and .rejected
        // route the user back through the onboarding KYC step (they need to
        // either start the flow or retry it via /kyc/retry); .unknown is the
        // forward-compat sentinel and routes the same way as a safe default.
        for status: KycStatus in [.unknown, .pending, .rejected] {
            XCTAssertEqual(
                RootRouter.route(hasActiveSession: true, kycStatus: status),
                .onboardingResumeAtKYC,
                "resumable kyc state \(status) should route to onboardingResumeAtKYC"
            )
        }
    }
}
