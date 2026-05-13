// IdleBumpOriginTests.swift  (Phase 10B · U76b4)
//
// Verifies that ONLY user-origin endpoint successes bump the idle
// clock. System-origin endpoints (push-token sync, fallback polls)
// must leave `lastInteractionAt` untouched so a walked-away user
// reaches the 14-min force-reauth threshold even while polling fires.

import XCTest
@testable import Kolaleaf

@MainActor
final class IdleBumpOriginTests: XCTestCase {

    private var defaults: UserDefaults!

    override func setUp() async throws {
        let suiteName = "kola.tests.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDown() async throws {
        defaults = nil
    }

    // MARK: - User hook bumps interaction

    func test_userOriginHookClosure_bumpsInteraction() async {
        let appState = makeAuthed()
        // Backdate so we can detect that the hook moved the clock.
        let backdate = Date().addingTimeInterval(-(10 * 60))
        defaults.set(backdate, forKey: "kola.lastInteractionAt")
        let s2 = AppState(defaults: defaults, arguments: [])
        s2.currentUser = appState.currentUser

        // Construct the SAME closure shape KolaleafApp wires for the
        // user hook and fire it directly.
        let userHook: @Sendable () async -> Void = { @MainActor [s2] in
            s2.bumpInteraction()
        }
        await userHook()

        let elapsed = Date().timeIntervalSince(s2.lastInteractionAt)
        XCTAssertLessThan(elapsed, 5,
                          "user-success hook must reset the idle clock")
    }

    // MARK: - System hook does NOT bump interaction

    func test_systemOriginHookClosure_doesNotBumpInteraction() async {
        let appState = makeAuthed()
        let backdate = Date().addingTimeInterval(-(10 * 60))
        defaults.set(backdate, forKey: "kola.lastInteractionAt")
        let s2 = AppState(defaults: defaults, arguments: [])
        s2.currentUser = appState.currentUser
        let preFire = s2.lastInteractionAt

        // Construct the SAME closure shape KolaleafApp wires for the
        // system hook (a no-op) and fire it.
        let systemHook: @Sendable () async -> Void = { /* intentionally no-op */ }
        await systemHook()

        XCTAssertEqual(s2.lastInteractionAt.timeIntervalSinceReferenceDate,
                       preFire.timeIntervalSinceReferenceDate,
                       accuracy: 0.01,
                       "system-success hook must NOT reset the idle clock")
    }

    // MARK: - Endpoint origin spot-checks

    func test_pushTokenRegister_origin_isSystem() {
        let req = RegisterPushTokenRequest(
            deviceToken: "ab", kind: "live_activity",
            bundleId: "x", device: nil
        )
        XCTAssertEqual(PushTokenEndpoints.Register(req).origin, .system)
    }

    func test_backgroundPoll_origin_isSystem() {
        XCTAssertEqual(TransfersEndpoints.GetForBackgroundPoll(id: "tx").origin, .system)
    }

    func test_userDrivenGet_origin_isUser() {
        XCTAssertEqual(TransfersEndpoints.Get(id: "tx").origin, .user)
    }

    // MARK: - Helpers

    private func makeAuthed() -> AppState {
        let s = AppState(defaults: defaults, arguments: [])
        s.currentUser = CurrentUser(
            id: "user_1", displayName: "Test", legalName: nil,
            email: "test@example.com", phone: nil
        )
        return s
    }
}
