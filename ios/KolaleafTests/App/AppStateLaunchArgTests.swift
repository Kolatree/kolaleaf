// AppStateLaunchArgTests.swift  (Phase 0 · U76b3)
// Validates that --idle-threshold / --background-idle / --inflight-idle launch args
// override the per-instance idle thresholds in DEBUG builds. Release builds skip
// the tests at compile time — UI tests don't run against release.

import XCTest
@testable import Kolaleaf

@MainActor
final class AppStateLaunchArgTests: XCTestCase {

    private var defaults: UserDefaults!

    override func setUp() async throws {
        let suiteName = "kola.tests.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDown() async throws {
        defaults = nil
    }

    // MARK: - Defaults

    func test_idleThreshold_defaultsTo14Min_whenNoArg() {
        let s = AppState(defaults: defaults, arguments: [])
        XCTAssertEqual(s.idleThresholdSeconds, 14 * 60)
        XCTAssertEqual(s.backgroundIdleSeconds, 15 * 60)
        XCTAssertEqual(s.inflightIdleSeconds, 90 * 60)
    }

    // MARK: - Override happy path

    #if DEBUG
    func test_idleThreshold_overridesToCustomValue_whenArgPresent() {
        let s = AppState(defaults: defaults, arguments: ["--idle-threshold=60"])
        XCTAssertEqual(s.idleThresholdSeconds, 60)
        // Other thresholds untouched.
        XCTAssertEqual(s.backgroundIdleSeconds, 15 * 60)
        XCTAssertEqual(s.inflightIdleSeconds, 90 * 60)
    }

    func test_backgroundIdle_overridesIndependently() {
        let s = AppState(defaults: defaults, arguments: ["--background-idle=30"])
        XCTAssertEqual(s.backgroundIdleSeconds, 30)
        XCTAssertEqual(s.idleThresholdSeconds, 14 * 60)
    }

    func test_inflightIdle_overridesIndependently() {
        let s = AppState(defaults: defaults, arguments: ["--inflight-idle=120"])
        XCTAssertEqual(s.inflightIdleSeconds, 120)
        XCTAssertEqual(s.idleThresholdSeconds, 14 * 60)
    }

    func test_allThree_overrideTogether() {
        let s = AppState(defaults: defaults,
                         arguments: ["--idle-threshold=10",
                                     "--background-idle=20",
                                     "--inflight-idle=30"])
        XCTAssertEqual(s.idleThresholdSeconds, 10)
        XCTAssertEqual(s.backgroundIdleSeconds, 20)
        XCTAssertEqual(s.inflightIdleSeconds, 30)
    }

    // MARK: - Clamp

    func test_idleThreshold_clampsToMinimum1_whenArgIsZero() {
        let s = AppState(defaults: defaults, arguments: ["--idle-threshold=0"])
        XCTAssertEqual(s.idleThresholdSeconds, 1)
    }

    func test_idleThreshold_clampsToMinimum1_whenArgIsNegative() {
        let s = AppState(defaults: defaults, arguments: ["--idle-threshold=-99"])
        XCTAssertEqual(s.idleThresholdSeconds, 1)
    }

    func test_idleThreshold_clampsToMaximum3600_whenArgExceeds() {
        let s = AppState(defaults: defaults, arguments: ["--idle-threshold=99999"])
        XCTAssertEqual(s.idleThresholdSeconds, 3600)
    }

    // MARK: - Malformed arg falls back

    func test_idleThreshold_fallsBackToDefault_whenArgMalformed() {
        let s = AppState(defaults: defaults, arguments: ["--idle-threshold=abc"])
        XCTAssertEqual(s.idleThresholdSeconds, 14 * 60)
    }

    func test_idleThreshold_fallsBackToDefault_whenArgEmpty() {
        let s = AppState(defaults: defaults, arguments: ["--idle-threshold="])
        XCTAssertEqual(s.idleThresholdSeconds, 14 * 60)
    }

    // MARK: - Integration: shouldForceReauth uses instance threshold

    func test_shouldForceReauth_usesInstanceThreshold_notStatic() {
        // Override foreground threshold to 60s.
        defaults.set(Date().addingTimeInterval(-61),
                     forKey: "kola.lastInteractionAt")
        let s = AppState(defaults: defaults, arguments: ["--idle-threshold=60"])
        s.currentUser = CurrentUser(
            id: "user_1", displayName: "Test", legalName: nil,
            email: "test@example.com", phone: nil
        )
        XCTAssertTrue(s.shouldForceReauth(),
                      "61-second backdate should trip the 60-second override threshold")
    }

    func test_shouldForceReauth_doesNotTripBelowOverride() {
        defaults.set(Date().addingTimeInterval(-30),
                     forKey: "kola.lastInteractionAt")
        let s = AppState(defaults: defaults, arguments: ["--idle-threshold=60"])
        s.currentUser = CurrentUser(
            id: "user_1", displayName: "Test", legalName: nil,
            email: "test@example.com", phone: nil
        )
        XCTAssertFalse(s.shouldForceReauth(),
                       "30-second backdate is within the 60-second override")
    }

    func test_shouldForceReauth_usesBackgroundOverride() {
        defaults.set(Date().addingTimeInterval(-31),
                     forKey: "kola.lastBackgroundedAt")
        let s = AppState(defaults: defaults, arguments: ["--background-idle=30"])
        s.currentUser = CurrentUser(
            id: "user_1", displayName: "Test", legalName: nil,
            email: "test@example.com", phone: nil
        )
        XCTAssertTrue(s.shouldForceReauth(),
                      "31-second background should trip the 30-second override")
    }
    #endif
}
