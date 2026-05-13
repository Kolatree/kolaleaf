// PushPermissionServiceTests.swift  (Phase 2 · U28)

import XCTest
import UserNotifications
@testable import Kolaleaf

final class PushPermissionServiceTests: XCTestCase {

    // MARK: - Fake notification center

    actor FakeNotifCenter: UserNotificationCenterAPI {
        var status: PushAuthorizationStatus
        var requestedOptions: UNAuthorizationOptions?
        var grantNext: Bool
        var throwNext: Error?

        init(status: PushAuthorizationStatus, grantNext: Bool = true) {
            self.status = status
            self.grantNext = grantNext
        }

        func setStatus(_ s: PushAuthorizationStatus) { status = s }
        func setGrantNext(_ g: Bool) { grantNext = g }
        func setThrowNext(_ e: Error?) { throwNext = e }
        func capturedOptions() -> UNAuthorizationOptions? { requestedOptions }

        func requestAuthorization(options: UNAuthorizationOptions) async throws -> Bool {
            requestedOptions = options
            if let err = throwNext { throwNext = nil; throw err }
            // After a successful grant the status flips to authorized; iOS
            // would do this too once the dialog resolves.
            if grantNext { status = .authorized } else { status = .denied }
            return grantNext
        }

        func currentAuthorizationStatus() async -> PushAuthorizationStatus { status }
    }

    // MARK: - promptIfNeeded

    func test_promptIfNeeded_alreadyAuthorized_returnsAlreadyDeterminedTrue() async {
        let fake = FakeNotifCenter(status: .authorized)
        let svc = PushPermissionService(api: FakeAPIClient(), center: fake)
        let outcome = await svc.promptIfNeeded()
        XCTAssertEqual(outcome, .alreadyDetermined(authorized: true))
    }

    func test_promptIfNeeded_provisional_returnsAuthorized() async {
        let fake = FakeNotifCenter(status: .provisional)
        let svc = PushPermissionService(api: FakeAPIClient(), center: fake)
        let outcome = await svc.promptIfNeeded()
        XCTAssertEqual(outcome, .alreadyDetermined(authorized: true))
    }

    func test_promptIfNeeded_denied_returnsAlreadyDeterminedFalse() async {
        let fake = FakeNotifCenter(status: .denied)
        let svc = PushPermissionService(api: FakeAPIClient(), center: fake)
        let outcome = await svc.promptIfNeeded()
        XCTAssertEqual(outcome, .alreadyDetermined(authorized: false))
    }

    func test_promptIfNeeded_notDetermined_andGranted_returnsGranted() async {
        let fake = FakeNotifCenter(status: .notDetermined, grantNext: true)
        let svc = PushPermissionService(api: FakeAPIClient(), center: fake)
        let outcome = await svc.promptIfNeeded()
        XCTAssertEqual(outcome, .granted)
        let opts = await fake.capturedOptions()
        XCTAssertNotNil(opts)
        XCTAssertTrue(opts?.contains(.alert) ?? false)
        XCTAssertTrue(opts?.contains(.badge) ?? false)
        XCTAssertTrue(opts?.contains(.sound) ?? false)
    }

    func test_promptIfNeeded_notDetermined_userDenies_returnsDenied() async {
        let fake = FakeNotifCenter(status: .notDetermined, grantNext: false)
        let svc = PushPermissionService(api: FakeAPIClient(), center: fake)
        let outcome = await svc.promptIfNeeded()
        XCTAssertEqual(outcome, .denied)
    }

    func test_promptIfNeeded_authThrows_returnsError() async {
        struct BoomError: Error {}
        let fake = FakeNotifCenter(status: .notDetermined)
        await fake.setThrowNext(BoomError())
        let svc = PushPermissionService(api: FakeAPIClient(), center: fake)
        let outcome = await svc.promptIfNeeded()
        if case .error = outcome { /* pass */ } else { XCTFail("expected .error, got \(outcome)") }
    }

    // MARK: - register

    func test_register_postsHexEncodedToken_withDefaultKind() async {
        let api = FakeAPIClient()
        await api.stageSuccess(PushTokenEndpoints.Register.self, EmptyResponse())
        let svc = PushPermissionService(api: api, center: FakeNotifCenter(status: .authorized),
                                        bundleId: "com.kolaleaf.test", device: "iPhone16,1")

        // Token bytes 0xDE 0xAD 0xBE 0xEF -> "deadbeef"
        let token = Data([0xDE, 0xAD, 0xBE, 0xEF])
        let result = await svc.register(deviceToken: token)
        if case .success = result { /* ok */ } else { XCTFail("expected success, got \(result)") }

        let body = await api.lastBody(
            for: String(describing: PushTokenEndpoints.Register.self),
            as: RegisterPushTokenRequest.self
        )
        XCTAssertEqual(body?.deviceToken, "deadbeef")
        XCTAssertEqual(body?.kind, .notification)
        XCTAssertEqual(body?.bundleId, "com.kolaleaf.test")
        XCTAssertEqual(body?.device, "iPhone16,1")
    }

    func test_register_liveActivityKind_postsLiveActivityValue() async {
        let api = FakeAPIClient()
        await api.stageSuccess(PushTokenEndpoints.Register.self, EmptyResponse())
        let svc = PushPermissionService(api: api, center: FakeNotifCenter(status: .authorized))
        _ = await svc.register(deviceToken: Data([0x01]), kind: .liveActivity)

        let body = await api.lastBody(
            for: String(describing: PushTokenEndpoints.Register.self),
            as: RegisterPushTokenRequest.self
        )
        XCTAssertEqual(body?.kind, .liveActivity)
    }
}
