// MyPayIDViewModelTests.swift  (Phase 7 · U53 → iter-2 C3 / ADV-P7-C2)
// Behaviour spec for the Account → My PayID screen (Screen 25).
//
// Iter-2 money-path safety: email is NOT a PayID. The backend doesn't
// expose an allocated handle in `/account/me` yet, so EVERY successful
// load lands on `.unavailable`. The `.allocated` path stays in the VM
// for the future backend wire-up but cannot be reached without a
// real handle. We assert both shapes here.

import XCTest
@testable import Kolaleaf

@MainActor
final class MyPayIDViewModelTests: XCTestCase {

    private func makeMe(
        primaryEmail: String? = "ada@example.com",
        userId: String = "u_001"
    ) -> MeResponse {
        let email = primaryEmail.map {
            EmailIdentifierDTO(id: "eid", email: $0, verified: true)
        }
        return MeResponse(
            userId: userId,
            fullName: "Ada Lovelace",
            displayName: "Ada",
            primaryEmail: email,
            secondaryEmails: [],
            twoFactorMethod: nil,
            twoFactorEnabledAt: nil,
            hasVerifiedPhone: false,
            phoneMasked: nil,
            hasRemainingBackupCodes: false,
            backupCodesRemaining: 0,
            addressLine1: nil,
            addressLine2: nil,
            city: nil,
            state: nil,
            postcode: nil,
            country: nil,
            kycStatus: .verified
        )
    }

    // MARK: - Load lifecycle

    func test_load_success_marksUnavailable_evenWhenPrimaryEmailPresent() async {
        // Iter-2 C3: email IS NOT a PayID. Iter-1 derived the display
        // handle from primaryEmail and showed it as a PayID — money-
        // misroute risk. The successful-load path now always returns
        // .unavailable until the backend ships an allocated handle.
        let api = FakeAPIClient()
        await api.stageSuccess(AccountEndpoints.Me.self, makeMe(primaryEmail: "ada@example.com"))
        let vm = MyPayIDViewModel(api: api)

        await vm.load()

        guard case .unavailable(let reason, let fallback) = vm.state else {
            return XCTFail("Expected .unavailable, got \(vm.state)")
        }
        XCTAssertEqual(reason, MyPayIDViewModel.unavailableReason)
        XCTAssertEqual(fallback, MyPayIDViewModel.defaultFallbackBankAccount)
    }

    func test_load_marksUnavailable_whenPrimaryEmailMissing() async {
        let api = FakeAPIClient()
        await api.stageSuccess(AccountEndpoints.Me.self, makeMe(primaryEmail: nil))
        let vm = MyPayIDViewModel(api: api)

        await vm.load()

        if case .unavailable = vm.state { } else {
            XCTFail("Expected .unavailable, got \(vm.state)")
        }
    }

    func test_load_failure_setsFailedState() async {
        let api = FakeAPIClient()
        await api.stageFailure(AccountEndpoints.Me.self, .transport("offline"))
        let vm = MyPayIDViewModel(api: api)

        await vm.load()

        if case .failed = vm.state { } else {
            XCTFail("Expected .failed, got \(vm.state)")
        }
    }

    // MARK: - QR URI

    func test_qrPayload_isPayIDURI() {
        let vm = MyPayIDViewModel(api: FakeAPIClient())
        let handle = PayIDHandle(value: "ada@example.com", source: .allocated)
        XCTAssertEqual(
            vm.qrPayload(for: handle),
            "payid:ada@example.com"
        )
    }

    func test_qrImage_returnsNonNilForValidHandle() {
        let vm = MyPayIDViewModel(api: FakeAPIClient())
        let handle = PayIDHandle(value: "ada@example.com", source: .allocated)
        let image = vm.qrImage(for: handle)
        XCTAssertNotNil(image, "QRCodeRenderer should rasterise a UIImage.")
    }

    // MARK: - Fallback BSB / account

    func test_fallbackBankAccount_isStaticPlaceholderUntilBackendShips() {
        // S3 / CA-006: fallback lives on the .unavailable state payload
        // so a per-user backend allocation is a one-field swap when it
        // ships. The static default is exposed for callers that need
        // it pre-load (e.g. previews).
        XCTAssertNotNil(MyPayIDViewModel.defaultFallbackBankAccount.bsb)
        XCTAssertNotNil(MyPayIDViewModel.defaultFallbackBankAccount.accountNumber)
    }
}
