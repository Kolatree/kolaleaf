// SignInViewModelTests.swift  (Phase 1 · U23b)
// TDD spec for the sign-in screen view model.

import XCTest
@testable import Kolaleaf

@MainActor
final class SignInViewModelTests: XCTestCase {

    private func makeVM(
        api: AuthAPI,
        onSignedIn: @escaping (LoginResult) -> Void = { _ in },
        onVerificationRequired: @escaping (String) -> Void = { _ in }
    ) -> SignInViewModel {
        SignInViewModel(api: api,
                        onSignedIn: onSignedIn,
                        onVerificationRequired: onVerificationRequired)
    }

    // MARK: - canSubmit

    func test_canSubmit_falseWhenEmpty() {
        let vm = makeVM(api: FakeAPIClient())
        XCTAssertFalse(vm.canSubmit)
    }

    func test_canSubmit_falseWithEmailOnly() {
        let vm = makeVM(api: FakeAPIClient())
        vm.email = "user@example.com"
        XCTAssertFalse(vm.canSubmit)
    }

    func test_canSubmit_trueWithBothFields() {
        let vm = makeVM(api: FakeAPIClient())
        vm.email = "user@example.com"
        vm.password = "anything"
        XCTAssertTrue(vm.canSubmit)
    }

    // MARK: - submit success

    func test_submit_200_callsOnSignedIn() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            AuthEndpoints.Login.self,
            LoginResponse(user: .init(id: "u1", fullName: "Ada"),
                          requiresTwoFactor: false,
                          twoFactorMethod: "NONE")
        )

        var captured: LoginResult?
        let vm = makeVM(api: api,
                        onSignedIn: { captured = $0 },
                        onVerificationRequired: { _ in XCTFail("should not be called") })
        vm.email = "user@example.com"
        vm.password = "Correct-Horse-1234"
        await vm.submit()

        XCTAssertEqual(captured?.user.id, "u1")
        XCTAssertEqual(captured?.user.legalName, "Ada")
        XCTAssertEqual(captured?.user.email, "user@example.com")
        XCTAssertEqual(captured?.requires2FA, false)
        XCTAssertEqual(captured?.twoFactorMethod, "NONE")
        XCTAssertNil(vm.inlineError)
    }

    /// P1 fix (Phase 1 review): security-critical test asserting the LoginResult
    /// faithfully carries `requires2FA = true` from the backend. Combined with
    /// the OnboardingCoordinator P0 fix (which gates `appState.currentUser` on
    /// `requires2FA == false`), this test guards against a regression that would
    /// strand 2FA-enabled users on KYC intro with no recovery path.
    func test_submit_200_with2FARequired_propagatesFlag() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            AuthEndpoints.Login.self,
            LoginResponse(user: .init(id: "u1", fullName: "Ada"),
                          requiresTwoFactor: true,
                          twoFactorMethod: "TOTP")
        )

        var captured: LoginResult?
        let vm = makeVM(api: api,
                        onSignedIn: { captured = $0 },
                        onVerificationRequired: { _ in XCTFail("should not be called") })
        vm.email = "user@example.com"
        vm.password = "Correct-Horse-1234"
        await vm.submit()

        XCTAssertEqual(captured?.requires2FA, true,
                       "VM must forward requires2FA so the coordinator can gate appState.currentUser")
        XCTAssertEqual(captured?.twoFactorMethod, "TOTP")
        XCTAssertNil(vm.inlineError)
    }

    // MARK: - 202 verification-required

    func test_submit_202_verificationRequired_callsOnVerificationRequired_notOnSignedIn() async {
        let api = FakeAPIClient()
        await api.stageFailure(
            AuthEndpoints.Login.self,
            .verificationRequired(email: "user@example.com",
                                  message: "Please verify your email")
        )

        var signedInCalls = 0
        var verifyEmail: String?
        let vm = makeVM(api: api,
                        onSignedIn: { _ in signedInCalls += 1 },
                        onVerificationRequired: { verifyEmail = $0 })
        vm.email = "user@example.com"
        vm.password = "Correct-Horse-1234"
        await vm.submit()

        XCTAssertEqual(signedInCalls, 0)
        XCTAssertEqual(verifyEmail, "user@example.com")
        XCTAssertNil(vm.inlineError)
    }

    // MARK: - error mapping

    func test_submit_401_setsInlineError_doesNotCallEitherCallback() async {
        let api = FakeAPIClient()
        await api.stageFailure(AuthEndpoints.Login.self, .unauthorized)

        var signedInCalls = 0
        var verifyCalls = 0
        let vm = makeVM(api: api,
                        onSignedIn: { _ in signedInCalls += 1 },
                        onVerificationRequired: { _ in verifyCalls += 1 })
        vm.email = "user@example.com"
        vm.password = "wrong"
        await vm.submit()

        XCTAssertEqual(signedInCalls, 0)
        XCTAssertEqual(verifyCalls, 0)
        XCTAssertNotNil(vm.inlineError)
    }

    func test_submit_422_setsInlineError() async {
        let api = FakeAPIClient()
        await api.stageFailure(
            AuthEndpoints.Login.self,
            .validation(fields: ["password": ["Password is required"]])
        )
        let vm = makeVM(api: api)
        vm.email = "user@example.com"
        vm.password = ""
        // Direct submit (bypassing canSubmit) — VM should still surface 422 cleanly.
        vm.password = "Anything"
        await vm.submit()

        XCTAssertNotNil(vm.inlineError)
    }

    func test_submit_429_setsInlineError_withRetryAfter() async {
        let api = FakeAPIClient()
        await api.stageFailure(AuthEndpoints.Login.self, .rateLimited(retryAfter: 45))
        let vm = makeVM(api: api)
        vm.email = "user@example.com"
        vm.password = "Anything"
        await vm.submit()

        XCTAssertNotNil(vm.inlineError)
        XCTAssertTrue(vm.inlineError?.contains("45") ?? false,
                      "Expected retry-after seconds in message, got: \(vm.inlineError ?? "nil")")
    }

    // MARK: - request shape

    func test_submit_normalizesEmail_andSendsIdentifierShape() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            AuthEndpoints.Login.self,
            LoginResponse(user: .init(id: "u1", fullName: nil), requiresTwoFactor: false, twoFactorMethod: nil)
        )
        let vm = makeVM(api: api)
        vm.email = "  USER@Example.COM  "
        vm.password = "Correct-Horse-1234"
        await vm.submit()

        let body = await api.lastBody(
            for: String(describing: AuthEndpoints.Login.self),
            as: LoginRequestEcho.self
        )
        XCTAssertEqual(body?.identifier.type, "email")
        XCTAssertEqual(body?.identifier.value, "user@example.com")
        XCTAssertEqual(body?.password, "Correct-Horse-1234")
    }
}

// Local Decodable echo of LoginRequest's wire shape so tests can assert the body.
private struct LoginRequestEcho: Decodable, Sendable {
    struct Identifier: Decodable, Sendable {
        let type: String
        let value: String
    }
    let identifier: Identifier
    let password: String
}
