// PhoneNumberTests.swift  (Phase 11A-3 · phone-first onboarding)
//
// Locks the E.164 contract shared between iOS and the backend.
// Backend Zod regex: `^\+\d{7,15}$` (src/app/api/v1/auth/send-code/_schemas.ts).
// PhoneNumber.parse(...) must produce values that pass that regex AND
// reject inputs the regex would reject — otherwise the client
// pre-validates a number the server later rejects, or vice versa.

import XCTest
@testable import Kolaleaf

final class PhoneNumberTests: XCTestCase {

    // MARK: - parse(dialCode:localNumber:)

    func test_parseStripsSpacesDashesParens() throws {
        let result = PhoneNumber.parse(dialCode: "+61", localNumber: "0400 000 000")
        guard case .success(let phone) = result else {
            return XCTFail("expected success, got \(result)")
        }
        XCTAssertEqual(phone.e164, "+61400000000")
    }

    func test_parseStripsAUNationalTrunkPrefix() throws {
        let result = PhoneNumber.parse(dialCode: "+61", localNumber: "0412345678")
        guard case .success(let phone) = result else {
            return XCTFail("expected success, got \(result)")
        }
        XCTAssertEqual(phone.e164, "+61412345678")
    }

    func test_parseHandlesUserTypingDialCodeIntoLocal() throws {
        let result = PhoneNumber.parse(dialCode: "+61", localNumber: "+61 400 000 000")
        guard case .success(let phone) = result else {
            return XCTFail("expected success, got \(result)")
        }
        XCTAssertEqual(phone.e164, "+61400000000")
    }

    func test_parseHandlesPlainDigitsNoTrunk() throws {
        let result = PhoneNumber.parse(dialCode: "+234", localNumber: "8012345678")
        guard case .success(let phone) = result else {
            return XCTFail("expected success, got \(result)")
        }
        XCTAssertEqual(phone.e164, "+2348012345678")
    }

    func test_parseRejectsEmptyInput() {
        let result = PhoneNumber.parse(dialCode: "+61", localNumber: "   ")
        guard case .failure(.empty) = result else {
            return XCTFail("expected .empty failure, got \(result)")
        }
    }

    func test_parseRejectsTooShort() {
        // E.164 minimum is 7 digits total (including dial code).
        // +61 contributes 2 digits, so 4 local digits = 6 total =
        // below the minimum. Anything ≥5 local digits would pass.
        let result = PhoneNumber.parse(dialCode: "+61", localNumber: "1234")
        guard case .failure(.malformed) = result else {
            return XCTFail("expected .malformed failure, got \(result)")
        }
    }

    func test_parseRejectsTooLong() {
        // 14 digits local + 2 digit dial = 16 → exceeds E.164's 15-digit cap.
        let result = PhoneNumber.parse(dialCode: "+61", localNumber: "12345678901234")
        guard case .failure(.malformed) = result else {
            return XCTFail("expected .malformed failure, got \(result)")
        }
    }

    func test_parseRejectsLettersAndSymbols() {
        let result = PhoneNumber.parse(dialCode: "+61", localNumber: "0400ABCD")
        guard case .failure(.malformed) = result else {
            return XCTFail("expected .malformed failure, got \(result)")
        }
    }

    // MARK: - parseE164(_:)

    func test_parseE164AcceptsCanonical() throws {
        let result = PhoneNumber.parseE164("+61400000000")
        guard case .success(let phone) = result else {
            return XCTFail("expected success, got \(result)")
        }
        XCTAssertEqual(phone.e164, "+61400000000")
    }

    func test_parseE164StripsFormatting() throws {
        let result = PhoneNumber.parseE164("+61 (400) 000-000")
        guard case .success(let phone) = result else {
            return XCTFail("expected success, got \(result)")
        }
        XCTAssertEqual(phone.e164, "+61400000000")
    }

    func test_parseE164RejectsMissingPlus() {
        let result = PhoneNumber.parseE164("61400000000")
        guard case .failure(.malformed) = result else {
            return XCTFail("expected .malformed failure, got \(result)")
        }
    }

    // MARK: - CountryDialCodes curated list

    func test_supportedCountriesIncludesAUandNG() {
        let codes = CountryDialCodes.supported.map(\.isoCode)
        XCTAssertTrue(codes.contains("AU"))
        XCTAssertTrue(codes.contains("NG"))
    }

    func test_defaultCountryIsAU() {
        XCTAssertEqual(CountryDialCodes.default.isoCode, "AU")
        XCTAssertEqual(CountryDialCodes.default.dialCode, "+61")
    }

    func test_lookupByDialCode() {
        XCTAssertEqual(CountryDialCodes.first(matchingDialCode: "+234")?.isoCode, "NG")
        XCTAssertNil(CountryDialCodes.first(matchingDialCode: "+999"))
    }

    // MARK: - DTO wire shape

    func test_sendCodeRequest_emailVariantSerialisation() throws {
        let req = SendCodeRequest(email: "a@b.com")
        XCTAssertEqual(req.type, .email)
        XCTAssertEqual(req.value, "a@b.com")
    }

    func test_sendCodeRequest_phoneVariantSerialisation() throws {
        let req = SendCodeRequest(phone: "+61400000000")
        XCTAssertEqual(req.type, .phone)
        XCTAssertEqual(req.value, "+61400000000")
    }

    func test_verifyCodeRequest_phoneVariant() throws {
        let req = VerifyCodeRequest(phone: "+61400000000", code: "123456")
        XCTAssertEqual(req.type, .phone)
        XCTAssertEqual(req.value, "+61400000000")
        XCTAssertEqual(req.code, "123456")
    }

    func test_loginRequest_phoneVariant() throws {
        let req = LoginRequest(phone: "+61400000000", password: "Hunter2!")
        XCTAssertEqual(req.identifier.type, .phone)
        XCTAssertEqual(req.identifier.value, "+61400000000")
        XCTAssertEqual(req.password, "Hunter2!")
    }

    // MARK: - IdentifierKind wire shape

    /// 4-lens review fix (type-design-analyzer): the discriminator
    /// must encode to the exact strings the backend Zod
    /// `discriminatedUnion("type", …)` expects. A wire change here
    /// breaks every wizard call.
    func test_identifierKind_encodesAsWireStrings() throws {
        let encoder = JSONEncoder()
        let emailData = try encoder.encode(IdentifierKind.email)
        let phoneData = try encoder.encode(IdentifierKind.phone)
        XCTAssertEqual(String(data: emailData, encoding: .utf8), "\"email\"")
        XCTAssertEqual(String(data: phoneData, encoding: .utf8), "\"phone\"")
    }
}
