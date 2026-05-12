// AccountViewModelTests.swift  (Phase 8 · U60)
// Covers:
//   • Happy path: VM loads profile from /account/me; falls back to
//     primary email when displayName + fullName are nil.
//   • Initials: derived from displayName (two-word, one-word, empty).
//   • KYC label: maps every status to a stable display string.
//   • Session expired: unauthorized → .sessionExpired.

import XCTest
@testable import Kolaleaf

@MainActor
final class AccountViewModelTests: XCTestCase {

    private func stubMe(
        displayName: String? = "Ada Lovelace",
        fullName: String? = "Ada Augusta Lovelace",
        email: String? = "ada@example.com",
        kyc: KycStatus = .verified
    ) -> MeResponse {
        MeResponse(
            userId: "u1",
            fullName: fullName,
            displayName: displayName,
            primaryEmail: email.map {
                EmailIdentifierDTO(id: "e1", email: $0, verified: true)
            },
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
            kycStatus: kyc
        )
    }

    func test_load_happyPath_setsLoadedProfile() async {
        let api = FakeAPIClient()
        await api.stageSuccess(AccountEndpoints.Me.self, stubMe())
        let vm = AccountViewModel(api: api)
        await vm.load()

        guard case .loaded(let profile) = vm.state else {
            return XCTFail("Expected .loaded, got \(vm.state)")
        }
        XCTAssertEqual(profile.displayName, "Ada Lovelace")
        XCTAssertEqual(profile.email, "ada@example.com")
        XCTAssertEqual(profile.kycStatus, .verified)
        XCTAssertEqual(profile.initials, "AL")
    }

    func test_load_displayNameNil_fallsBackToFullName() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            AccountEndpoints.Me.self,
            stubMe(displayName: nil, fullName: "John Smith")
        )
        let vm = AccountViewModel(api: api)
        await vm.load()

        guard case .loaded(let profile) = vm.state else {
            return XCTFail("Expected .loaded")
        }
        XCTAssertEqual(profile.displayName, "John Smith")
    }

    func test_load_bothNamesNil_fallsBackToEmail() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            AccountEndpoints.Me.self,
            stubMe(displayName: nil, fullName: nil,
                   email: "user@example.com")
        )
        let vm = AccountViewModel(api: api)
        await vm.load()

        guard case .loaded(let profile) = vm.state else {
            return XCTFail("Expected .loaded")
        }
        XCTAssertEqual(profile.displayName, "user@example.com")
    }

    func test_computeInitials_oneWord_returnsFirstTwoLetters() {
        XCTAssertEqual(AccountViewModel.computeInitials("Madonna"), "MA")
    }

    func test_computeInitials_empty_returnsQuestionMark() {
        XCTAssertEqual(AccountViewModel.computeInitials(""), "?")
    }

    func test_kycLabel_eachStatusHasAStableString() {
        XCTAssertEqual(AccountViewModel.kycLabel(.verified), "Verified")
        XCTAssertEqual(AccountViewModel.kycLabel(.pending),  "Pending")
        XCTAssertEqual(AccountViewModel.kycLabel(.inReview), "In review")
        XCTAssertEqual(AccountViewModel.kycLabel(.rejected), "Action needed")
        XCTAssertEqual(AccountViewModel.kycLabel(.unknown),  "Unknown")
    }

    func test_load_unauthorized_setsSessionExpired() async {
        let api = FakeAPIClient()
        await api.stageFailure(AccountEndpoints.Me.self, .unauthorized)
        let vm = AccountViewModel(api: api)
        await vm.load()
        XCTAssertEqual(vm.state, .sessionExpired)
    }
}
