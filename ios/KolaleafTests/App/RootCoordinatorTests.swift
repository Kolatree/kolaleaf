// RootCoordinatorTests.swift  (Phase 1 · U15 · extended in Phase 4 · U33)
// The view itself relies on SwiftUI scene plumbing, so we test the pure
// `RootRouter.route` decision matrix instead. This is the same matrix the
// view body runs through.
//
// Phase 4 / U33: route signature gained a `hasCompletedPostKYC` flag.
// Verified-KYC users branch on it: `false → .postKYC`, `true → .mainTab`.
//
// ADV-008 / CA-006: route signature gained a `kycStatusLoaded` flag.
// Authenticated users with an unloaded status route to `.loading`
// instead of folding `.unknown` into `.onboardingResumeAtKYC`. All
// existing assertions pass `kycStatusLoaded: true` to preserve the
// original matrix; two new tests cover the loading branch.

import XCTest
@testable import Kolaleaf

final class RootRouterTests: XCTestCase {

    func test_noSession_routesToOnboardingWelcome() {
        let r = RootRouter.route(
            hasActiveSession: false,
            kycStatusLoaded: true,
            kycStatus: .unknown,
            hasCompletedPostKYC: false
        )
        XCTAssertEqual(r, .onboardingWelcome)
    }

    func test_noSession_overridesAnyKYCStatus() {
        for status: KycStatus in [.unknown, .pending, .inReview, .verified, .rejected] {
            for postKyc in [true, false] {
                XCTAssertEqual(
                    RootRouter.route(
                        hasActiveSession: false,
                        kycStatusLoaded: true,
                        kycStatus: status,
                        hasCompletedPostKYC: postKyc
                    ),
                    .onboardingWelcome,
                    "no session should always route to onboardingWelcome (failed for \(status), postKyc=\(postKyc))"
                )
            }
        }
    }

    func test_session_kycVerified_postKYCNotComplete_routesToPostKYC() {
        let r = RootRouter.route(
            hasActiveSession: true,
            kycStatusLoaded: true,
            kycStatus: .verified,
            hasCompletedPostKYC: false
        )
        XCTAssertEqual(r, .postKYC)
    }

    func test_session_kycVerified_postKYCComplete_routesToMainTab() {
        let r = RootRouter.route(
            hasActiveSession: true,
            kycStatusLoaded: true,
            kycStatus: .verified,
            hasCompletedPostKYC: true
        )
        XCTAssertEqual(r, .mainTab)
    }

    func test_session_kycInReview_routesToKYCUnderReview() {
        let r = RootRouter.route(
            hasActiveSession: true,
            kycStatusLoaded: true,
            kycStatus: .inReview,
            hasCompletedPostKYC: false
        )
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
                RootRouter.route(
                    hasActiveSession: true,
                    kycStatusLoaded: true,
                    kycStatus: status,
                    hasCompletedPostKYC: false
                ),
                .onboardingResumeAtKYC,
                "resumable kyc state \(status) should route to onboardingResumeAtKYC"
            )
        }
    }

    // MARK: - Phase 4 / U33: PostKYC flag does not interfere with non-verified states.

    func test_postKYCComplete_doesNotShortCircuitInReview() {
        // Even if somehow the post-KYC flag is set (edge: backend
        // bumped status from VERIFIED back to IN_REVIEW for a
        // re-review), the KYC state still wins.
        let r = RootRouter.route(
            hasActiveSession: true,
            kycStatusLoaded: true,
            kycStatus: .inReview,
            hasCompletedPostKYC: true
        )
        XCTAssertEqual(r, .kycUnderReview)
    }

    // MARK: - ADV-008 / CA-006: .loading gate

    func test_session_kycStatusUnknown_andNotLoaded_routesToLoading() {
        // Cold-launch path for a verified user: AppState's initial
        // `kycStatus = .unknown` would otherwise flicker to
        // `.onboardingResumeAtKYC` for one frame before
        // `/account/me` lands. The .loading gate prevents that.
        let r = RootRouter.route(
            hasActiveSession: true,
            kycStatusLoaded: false,
            kycStatus: .unknown,
            hasCompletedPostKYC: false
        )
        XCTAssertEqual(r, .loading)
    }

    func test_session_kycStatusUnknown_butLoaded_falls_through_to_resume() {
        // After /account/me lands with a still-unknown status (e.g.
        // a forward-compat backend literal not yet in the iOS enum),
        // the resume-at-KYC fallback kicks in — the .loading gate
        // does not swallow the matrix.
        let r = RootRouter.route(
            hasActiveSession: true,
            kycStatusLoaded: true,
            kycStatus: .unknown,
            hasCompletedPostKYC: false
        )
        XCTAssertEqual(r, .onboardingResumeAtKYC)
    }
}
