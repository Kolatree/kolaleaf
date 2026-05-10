// OnboardingCoordinatorTests.swift  (Phase 1 · U23)
// Tests the pure transition rules. The SwiftUI shell composes these onto a
// NavigationStack but the rules themselves are value-only.

import XCTest
@testable import Kolaleaf

final class OnboardingTransitionTests: XCTestCase {

    // MARK: - From Welcome

    func test_fromWelcome_register_goesToEmailEntry() {
        XCTAssertEqual(OnboardingTransition.fromWelcome(action: .register), .emailEntry)
    }

    func test_fromWelcome_signIn_goesToSignIn() {
        XCTAssertEqual(OnboardingTransition.fromWelcome(action: .signIn), .signIn)
    }

    // MARK: - From EmailEntry

    func test_fromEmailEntry_carriesEmailToOTP() {
        let r = OnboardingTransition.fromEmailEntry(codeSentTo: "user@example.com")
        XCTAssertEqual(r, .emailOTP(email: "user@example.com"))
    }

    // MARK: - From EmailOTP

    func test_fromEmailOTP_carriesEmailToRegistrationDetails() {
        let r = OnboardingTransition.fromEmailOTP(verifiedEmail: "user@example.com")
        XCTAssertEqual(r, .registrationDetails(email: "user@example.com"))
    }

    // MARK: - From SignIn 202

    func test_fromSignInVerificationRequired_carriesEmailToOTP() {
        let r = OnboardingTransition.fromSignInVerificationRequired(email: "x@y.com")
        XCTAssertEqual(r, .emailOTP(email: "x@y.com"))
    }

    // MARK: - From RegistrationDetails

    func test_fromRegistrationDetails_goesToKYCIntro() {
        XCTAssertEqual(OnboardingTransition.fromRegistrationDetails(), .kycIntro)
    }

    // MARK: - Route equality

    func test_emailOTPRoutes_withDifferentEmails_areNotEqual() {
        XCTAssertNotEqual(
            OnboardingRoute.emailOTP(email: "a@b.com"),
            OnboardingRoute.emailOTP(email: "c@d.com")
        )
    }

    func test_route_isHashable_supportsNavigationPath() {
        // Hashable conformance is required by NavigationStack's typed path.
        var seen: Set<OnboardingRoute> = []
        seen.insert(.welcome)
        seen.insert(.signIn)
        seen.insert(.emailEntry)
        seen.insert(.emailOTP(email: "a@b.com"))
        seen.insert(.emailOTP(email: "a@b.com"))   // duplicate
        seen.insert(.registrationDetails(email: "a@b.com"))
        seen.insert(.kycIntro)
        XCTAssertEqual(seen.count, 6, "duplicate emailOTP route with same email should collapse")
    }

    // MARK: - Phase 2 KYC transitions

    private static let stubSession = KYCSession(
        applicantId: "appl_1",
        accessToken: "tok_x",
        verificationUrl: "https://sumsub.test/v?t=x"
    )

    func test_fromKYCIntro_pushesPreWarmWithSession() {
        let r = OnboardingTransition.fromKYCIntro(sessionFetched: Self.stubSession)
        XCTAssertEqual(r, .kycPreWarm(session: Self.stubSession))
    }

    func test_fromKYCPreWarm_pushesSumsubWithSession() {
        let r = OnboardingTransition.fromKYCPreWarm(session: Self.stubSession)
        XCTAssertEqual(r, .kycSumsub(session: Self.stubSession))
    }

    func test_fromSumsubResult_submitted_routesToProcessing() {
        let r = OnboardingTransition.fromSumsubResult(.submitted, currentStatus: .pending)
        XCTAssertEqual(r, .kycProcessing)
    }

    func test_fromSumsubResult_verdictGreen_routesToProcessing() {
        let r = OnboardingTransition.fromSumsubResult(
            .verdict(answer: "GREEN"), currentStatus: .pending)
        XCTAssertEqual(r, .kycProcessing)
    }

    func test_fromSumsubResult_verdictRed_routesToIntro() {
        let r = OnboardingTransition.fromSumsubResult(
            .verdict(answer: "RED"), currentStatus: .pending)
        XCTAssertEqual(r, .kycIntro)
    }

    func test_fromSumsubResult_cancelled_routesToIntro() {
        let r = OnboardingTransition.fromSumsubResult(.cancelled, currentStatus: .pending)
        XCTAssertEqual(r, .kycIntro)
    }

    func test_fromSumsubResult_failed_routesToIntro() {
        let r = OnboardingTransition.fromSumsubResult(
            .failed(code: "x", message: "y"), currentStatus: .pending)
        XCTAssertEqual(r, .kycIntro)
    }

    // MARK: - From KYCProcessing

    func test_fromKYCProcessing_rejected_routesToSoftRejection() {
        XCTAssertEqual(OnboardingTransition.fromKYCProcessing(.rejected), .kycSoftRejection)
    }

    func test_fromKYCProcessing_timedOut_routesToUnderReview() {
        XCTAssertEqual(OnboardingTransition.fromKYCProcessing(.timedOut), .kycUnderReview)
    }

    func test_fromKYCProcessing_verifiedAndUnauthorized_returnNil() {
        // Phase 2 review fix (correctness CR-3 / CR-6): .verified flips
        // appState.kycStatus (RootCoordinator hand-off to MainTab) and
        // .unauthorized triggers force-reauth via clearForLogout; neither
        // maps to an OnboardingRoute.
        XCTAssertNil(OnboardingTransition.fromKYCProcessing(.verified))
        XCTAssertNil(OnboardingTransition.fromKYCProcessing(.unauthorized))
    }
}
