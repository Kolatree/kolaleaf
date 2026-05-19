import XCTest
@testable import Kolaleaf

final class AppPasscodeServiceTests: XCTestCase {
    private var keychain: Keychain!
    private var service: AppPasscodeService!

    override func setUp() async throws {
        keychain = Keychain(service: "com.kolaleaf.tests.passcode.\(UUID().uuidString)")
        service = AppPasscodeService(keychain: keychain)
    }

    override func tearDown() async throws {
        await service.clear()
        service = nil
        keychain = nil
    }

    func test_normalizedKeepsSixDigitsOnly() {
        XCTAssertEqual(AppPasscodeService.normalized("12a 34-567"), "123456")
    }

    func test_setAndVerifyPasscode() async throws {
        try await service.setPasscode("123456")

        let isConfigured = await service.isConfigured()
        let validResult = await service.verify("123456")
        let invalidResult = await service.verify("654321")

        XCTAssertTrue(isConfigured)
        XCTAssertEqual(validResult, .success)
        XCTAssertEqual(invalidResult, .invalid)
    }

    func test_verifyWithoutConfiguredPasscode() async {
        let result = await service.verify("123456")
        XCTAssertEqual(result, .notConfigured)
    }

    func test_rejectsInvalidPasscodeFormat() async {
        do {
            try await service.setPasscode("12345")
            XCTFail("Expected invalid format")
        } catch AppPasscodeError.invalidFormat {
            let isConfigured = await service.isConfigured()
            XCTAssertFalse(isConfigured)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }
}
