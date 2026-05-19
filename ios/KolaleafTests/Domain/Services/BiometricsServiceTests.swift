// BiometricsServiceTests.swift  (Phase 6 · U45)
// LAContext is impractical to drive from a unit test (real biometric
// hardware required for live evaluation). What we CAN pin is the
// LAError → BiometricsResult mapping that determines app-unlock UX,
// plus the FakeBiometricsService contract used by lock-gate tests.

import XCTest
import LocalAuthentication
@testable import Kolaleaf

@MainActor
final class BiometricsServiceTests: XCTestCase {

    // MARK: - LAError mapping

    private func laError(_ code: LAError.Code) -> NSError {
        NSError(domain: LAErrorDomain, code: code.rawValue, userInfo: nil)
    }

    func test_map_userCancel() {
        XCTAssertEqual(LABiometricsService.map(laError(.userCancel)), .userCancel)
    }

    func test_map_appCancel_systemCancel_treatedAsUserCancel() {
        XCTAssertEqual(LABiometricsService.map(laError(.appCancel)), .userCancel)
        XCTAssertEqual(LABiometricsService.map(laError(.systemCancel)), .userCancel)
    }

    func test_map_userFallback() {
        XCTAssertEqual(LABiometricsService.map(laError(.userFallback)), .userFallback)
    }

    func test_map_biometryLockout() {
        XCTAssertEqual(LABiometricsService.map(laError(.biometryLockout)), .lockedOut)
    }

    func test_map_biometryNotEnrolled() {
        XCTAssertEqual(LABiometricsService.map(laError(.biometryNotEnrolled)), .notEnrolled)
    }

    func test_map_biometryNotAvailable() {
        XCTAssertEqual(LABiometricsService.map(laError(.biometryNotAvailable)), .noHardware)
    }

    func test_map_passcodeNotSet_treatedAsNoHardware() {
        XCTAssertEqual(LABiometricsService.map(laError(.passcodeNotSet)), .noHardware)
    }

    // Iter-2 (W2 / OO-003): authenticationFailed maps to a distinct
    // `.authFailed` so the lock screen surfaces "Face ID didn't match.
    // Try again." instead of the silent `.userCancel` UX.

    func test_map_unknownDomain_isUnknownError() {
        let error = NSError(domain: "com.example.weird", code: 99, userInfo: nil)
        if case .unknownError = LABiometricsService.map(error) {
            // ok
        } else {
            XCTFail("Non-LAErrorDomain must map to .unknownError")
        }
    }

    // MARK: - FakeBiometricsService contract

    func test_fake_returnsStagedResult() async {
        let fake = FakeBiometricsService(staged: .userCancel)
        let result = await fake.authenticate(intent: .unlockApp)
        XCTAssertEqual(result, .userCancel)
    }

    func test_fake_recordsLastReason() async {
        let fake = FakeBiometricsService(staged: .success)
        _ = await fake.authenticate(intent: .unlockApp)
        XCTAssertEqual(fake.lastReason, "Unlock Kolaleaf")
    }

    func test_fake_canRestageMidTest() async {
        let fake = FakeBiometricsService(staged: .success)
        let first = await fake.authenticate(intent: .unlockApp)
        XCTAssertEqual(first, .success)
        fake.stage(.lockedOut)
        let second = await fake.authenticate(intent: .unlockApp)
        XCTAssertEqual(second, .lockedOut)
    }

    // MARK: - W2 / OO-003: authFailed mapping is distinct from userCancel

    func test_map_authenticationFailed_treatedAsAuthFailed() {
        XCTAssertEqual(LABiometricsService.map(laError(.authenticationFailed)), .authFailed)
    }

    // MARK: - Availability mapping

    func test_availabilityFromBiometryNotEnrolled() {
        XCTAssertEqual(LABiometricsService.availability(from: laError(.biometryNotEnrolled)), .notEnrolled)
    }

    func test_availabilityFromBiometryNotAvailable() {
        XCTAssertEqual(LABiometricsService.availability(from: laError(.biometryNotAvailable)), .noHardware)
    }

    func test_availabilityFromBiometryLockout() {
        XCTAssertEqual(LABiometricsService.availability(from: laError(.biometryLockout)), .lockedOut)
    }

    func test_fake_returnsStagedAvailability() {
        let fake = FakeBiometricsService(availability: .notEnrolled)
        XCTAssertEqual(fake.availability(), .notEnrolled)
        XCTAssertEqual(fake.availabilityCallCount, 1)
        fake.stageAvailability(.available)
        XCTAssertEqual(fake.availability(), .available)
        XCTAssertEqual(fake.availabilityCallCount, 2)
    }
}
