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
}
