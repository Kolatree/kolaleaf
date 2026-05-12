// ReferViewModelTests.swift  (Phase 8 · U57)
// Covers:
//   • Happy path: VM loads from /account/me; code is nil (placeholder)
//     and stats default to .empty until the backend ships the fields.
//   • Share text: includes the code when present, friendly fallback
//     when absent.
//   • WhatsApp URL: encodes the share text into the deep-link.
//   • Session expired: unauthorized → .sessionExpired.

import XCTest
@testable import Kolaleaf

@MainActor
final class ReferViewModelTests: XCTestCase {

    private func stubMeResponse() -> MeResponse {
        MeResponse(
            userId: "u1",
            fullName: "Ada Lovelace",
            displayName: "Ada",
            primaryEmail: nil,
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

    func test_load_happyPath_setsLoadedWithPlaceholderCode() async {
        let api = FakeAPIClient()
        await api.stageSuccess(AccountEndpoints.Me.self, stubMeResponse())

        let vm = ReferViewModel(api: api)
        await vm.load()

        // TODO(backend): code is nil until /account/me ships a
        // `referralCode` field. Stats default to .empty until
        // /account/refer-stats exists.
        guard case .loaded(let code, let stats) = vm.state else {
            return XCTFail("Expected .loaded, got \(vm.state)")
        }
        XCTAssertNil(code)
        XCTAssertEqual(stats, .empty)
    }

    func test_shareText_withoutCode_fallsBackToInvitation() async {
        let api = FakeAPIClient()
        await api.stageSuccess(AccountEndpoints.Me.self, stubMeResponse())

        let vm = ReferViewModel(api: api)
        await vm.load()

        XCTAssertTrue(vm.shareText.contains("Kolaleaf"))
        XCTAssertFalse(vm.shareText.contains("$10 off"),
                       "Without a code we shouldn't promise a discount")
    }

    // Iter-2 (N8): until backend ships `referralCode` on MeResponse,
    // the VM keeps `code == nil` and the share URLs return nil so a
    // CTA can't open a share sheet with placeholder copy (which would
    // cost users their referral credit). When the backend lands the
    // field, replace these with the previous "URL is encoded / scheme
    // is https" assertions.
    func test_whatsAppURL_isNil_untilBackendShipsReferralCode() async {
        let api = FakeAPIClient()
        await api.stageSuccess(AccountEndpoints.Me.self, stubMeResponse())

        let vm = ReferViewModel(api: api)
        await vm.load()

        XCTAssertNil(vm.whatsAppURL)
    }

    func test_universalShareURL_isNil_untilBackendShipsReferralCode() async {
        let api = FakeAPIClient()
        await api.stageSuccess(AccountEndpoints.Me.self, stubMeResponse())

        let vm = ReferViewModel(api: api)
        await vm.load()

        XCTAssertNil(vm.universalShareURL)
    }

    func test_load_unauthorized_setsSessionExpired() async {
        let api = FakeAPIClient()
        await api.stageFailure(AccountEndpoints.Me.self, .unauthorized)

        let vm = ReferViewModel(api: api)
        await vm.load()

        XCTAssertEqual(vm.state, .sessionExpired)
    }
}
