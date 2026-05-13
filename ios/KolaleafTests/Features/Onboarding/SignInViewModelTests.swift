// SignInViewModelTests.swift  (Phase 1 · U23b)
// TDD spec for the sign-in screen view model.
//
// D4c: phone-default mode. Existing email-rail tests flip `mode = .email`
// at the top to preserve the iter-1 coverage shape; new phone-rail tests
// cover the default rail end-to-end (canSubmit + submit + wire body).

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
        vm.mode = .email
        vm.identifierInput = "user@example.com"
        XCTAssertFalse(vm.canSubmit)
    }

    func test_canSubmit_trueWithBothFields() {
        let vm = makeVM(api: FakeAPIClient())
        vm.mode = .email
        vm.identifierInput = "user@example.com"
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
        vm.mode = .email
        vm.identifierInput = "user@example.com"
        vm.password = "Correct-Horse-1234"
        await vm.submit()

        XCTAssertEqual(captured?.user.id, "u1")
        XCTAssertEqual(captured?.user.legalName, "Ada")
        XCTAssertEqual(captured?.user.email, "user@example.com")
        // iter-2 review fix (API-406): domain field renamed
        // `requires2FA` → `requiresTwoFactor`.
        XCTAssertEqual(captured?.requiresTwoFactor, false)
        XCTAssertEqual(captured?.twoFactorMethod, "NONE")
        XCTAssertNil(vm.inlineError)
    }

    /// P1 fix (Phase 1 review): security-critical test asserting the LoginResult
    /// faithfully carries `requiresTwoFactor = true` from the backend. Combined
    /// with the OnboardingCoordinator P0 fix (which gates `appState.currentUser`
    /// on `requiresTwoFactor == false`), this test guards against a regression
    /// that would strand 2FA-enabled users on KYC intro with no recovery path.
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
        vm.mode = .email
        vm.identifierInput = "user@example.com"
        vm.password = "Correct-Horse-1234"
        await vm.submit()

        XCTAssertEqual(captured?.requiresTwoFactor, true,
                       "VM must forward requiresTwoFactor so the coordinator can gate appState.currentUser")
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
        vm.mode = .email
        vm.identifierInput = "user@example.com"
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
        vm.mode = .email
        vm.identifierInput = "user@example.com"
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
        vm.mode = .email
        vm.identifierInput = "user@example.com"
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
        vm.mode = .email
        vm.identifierInput = "user@example.com"
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
        vm.mode = .email
        vm.identifierInput = "  USER@Example.COM  "
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

    // MARK: - phone-mode (D4c phone-default rail)

    /// Default mode is `.phone`. canSubmit must remain false until the input
    /// parses to a valid E.164 against the picked country dial code.
    func test_canSubmit_phoneMode_falseUntilParseable() {
        let vm = makeVM(api: FakeAPIClient())
        XCTAssertEqual(vm.mode, .phone, "mode should default to .phone per D4c")
        vm.password = "anything"
        vm.identifierInput = "abc"
        XCTAssertFalse(vm.canSubmit)
        vm.identifierInput = "040"  // too short for AU
        XCTAssertFalse(vm.canSubmit)
    }

    /// AU local "0400000000" with default +61 country must yield a valid
    /// canSubmit (PhoneNumber.parse strips the trunk-0).
    func test_canSubmit_phoneMode_trueForValidAULocal() {
        let vm = makeVM(api: FakeAPIClient())
        XCTAssertEqual(vm.country.dialCode, "+61")
        vm.identifierInput = "0400000000"
        vm.password = "Correct-Horse-1234"
        XCTAssertTrue(vm.canSubmit)
    }

    /// Phone-mode submit: sends a discriminated identifier with type=phone
    /// and the E.164 value; onSignedIn carries the phone, not the email.
    func test_submit_phoneMode_sendsPhoneIdentifier_andCarriesPhoneOnLoginResult() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            AuthEndpoints.Login.self,
            LoginResponse(user: .init(id: "u9", fullName: "Bola"),
                          requiresTwoFactor: false,
                          twoFactorMethod: "NONE")
        )

        var captured: LoginResult?
        let vm = makeVM(api: api,
                        onSignedIn: { captured = $0 },
                        onVerificationRequired: { _ in XCTFail("should not be called") })
        // Phone-default mode — no flip needed.
        vm.identifierInput = "0400 000 000"
        vm.password = "Correct-Horse-1234"
        await vm.submit()

        let body = await api.lastBody(
            for: String(describing: AuthEndpoints.Login.self),
            as: LoginRequestEcho.self
        )
        XCTAssertEqual(body?.identifier.type, "phone")
        XCTAssertEqual(body?.identifier.value, "+61400000000")
        XCTAssertEqual(body?.password, "Correct-Horse-1234")

        XCTAssertEqual(captured?.user.id, "u9")
        XCTAssertEqual(captured?.user.phone, "+61400000000")
        XCTAssertNil(captured?.user.email,
                     "phone-mode sign-in must NOT populate the email rail on CurrentUser")
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
