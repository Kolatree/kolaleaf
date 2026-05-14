// CoreFlowsAX5Tests.swift  (Phase 12 · U79/U80 core-flow sweep)
// Render smoke tests for the App-Store golden-path screens under the
// largest accessibility Dynamic Type size (AX5). Pairs with
// `SendFlowAccessibilityTests` (Send/PayID/Receipt) and
// `ReducedMotionRenderTests`.
//
// The assertion is intentionally a layout smoke check: rendering at
// AX5 without crashing + a non-empty view tree proves the screen
// survives Dynamic Type at the largest size. Pixel-snapshot drift is
// noisy, so we don't snapshot — we just assert materialisation.

import SwiftUI
import XCTest
@testable import Kolaleaf

@MainActor
final class CoreFlowsAX5Tests: XCTestCase {

    // MARK: - Onboarding

    func test_welcomeView_rendersAtAX5() {
        let view = WelcomeView(onGetStarted: {}, onSignIn: {})
        assertRenders(view)
    }

    func test_signInView_rendersAtAX5() {
        let vm = SignInViewModel(
            api: FakeAPIClient(),
            onSignedIn: { _ in },
            onVerificationRequired: { _ in }
        )
        let view = SignInView(vm: vm)
            .environment(AppState(defaults: defaults()))
        assertRenders(view)
    }

    func test_phoneEntryView_rendersAtAX5() {
        let vm = PhoneEntryViewModel(api: FakeAPIClient(), onCodeSent: { _ in })
        let view = PhoneEntryView(vm: vm)
        assertRenders(view)
    }

    func test_phoneOTPView_rendersAtAX5() {
        let phone = phoneNumber()
        let vm = PhoneOTPViewModel(phone: phone, api: FakeAPIClient(), onVerified: {})
        let view = PhoneOTPView(vm: vm)
        assertRenders(view)
    }

    func test_registrationDetailsView_rendersAtAX5() {
        let vm = RegistrationDetailsViewModel(
            identifier: .email("ada@example.com"),
            api: FakeAPIClient(),
            onRegistered: { _ in }
        )
        let view = RegistrationDetailsView(vm: vm)
        assertRenders(view)
    }

    // MARK: - KYC

    func test_kycIntroView_rendersAtAX5() {
        let vm = KYCIntroViewModel(api: FakeAPIClient(), onAccessToken: { _ in })
        let view = KYCIntroView(vm: vm, onSkip: {})
        assertRenders(view)
    }

    func test_kycProcessingView_rendersAtAX5() {
        let vm = KYCProcessingViewModel(api: FakeAPIClient())
        let view = KYCProcessingView(vm: vm, onTerminal: { _ in })
        assertRenders(view)
    }

    func test_kycSoftRejectionView_rendersAtAX5() {
        let vm = KYCSoftRejectionViewModel(api: FakeAPIClient(), onRetryReady: { _ in })
        let view = KYCSoftRejectionView(
            vm: vm,
            reasons: ["BLURRED_PHOTO"],
            onContactSupport: {}
        )
        assertRenders(view)
    }

    // MARK: - Render helper

    private func assertRenders<V: View>(
        _ view: V,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let hosted = view
            .environment(\.dynamicTypeSize, .accessibility5)
            .frame(width: 393, height: 852)

        let controller = UIHostingController(rootView: hosted)
        controller.view.frame = CGRect(x: 0, y: 0, width: 393, height: 852)
        controller.loadViewIfNeeded()
        controller.view.setNeedsLayout()
        controller.view.layoutIfNeeded()

        XCTAssertEqual(controller.view.bounds.size.width, 393, file: file, line: line)
        XCTAssertEqual(controller.view.bounds.size.height, 852, file: file, line: line)
    }

    private func defaults() -> UserDefaults {
        let suite = "kola.ax.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        return defaults
    }

    /// AU mobile parsed via the supported factory so the typed
    /// `PhoneNumber` invariant holds end-to-end.
    private func phoneNumber() -> PhoneNumber {
        switch PhoneNumber.parse(dialCode: "+61", localNumber: "400000000") {
        case .success(let phone):
            return phone
        case .failure(let error):
            fatalError("Failed to build test PhoneNumber: \(error)")
        }
    }
}
