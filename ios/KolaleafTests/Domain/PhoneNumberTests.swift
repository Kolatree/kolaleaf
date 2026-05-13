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

    /// 4-lens review fix (type-design-analyzer #15): NG (and most
    /// non-AU/NZ/GB/ZA countries) do NOT use a `0` trunk prefix.
    /// A leading `0` in a NG local number is a real digit. The
    /// per-country guard must NOT strip it.
    func test_parseDoesNotStripTrunkForNonTrunkCountries() throws {
        let result = PhoneNumber.parse(dialCode: "+234", localNumber: "08012345678")
        guard case .success(let phone) = result else {
            return XCTFail("expected success, got \(result)")
        }
        // The `0` survives — final number is +234 + 08012345678 = 14 digits.
        XCTAssertEqual(phone.e164, "+23408012345678")
    }

    func test_parseStripsTrunkForAU() throws {
        // Smoke test for the existing AU trunk-strip path. Already
        // covered by test_parseStripsAUNationalTrunkPrefix, but
        // documented here as the symmetric pair to
        // test_parseDoesNotStripTrunkForNonTrunkCountries.
        let result = PhoneNumber.parse(dialCode: "+61", localNumber: "0400000000")
        guard case .success(let phone) = result else {
            return XCTFail("expected success, got \(result)")
        }
        XCTAssertEqual(phone.e164, "+61400000000")
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

    // MARK: - displayFormatted (human projection)

    /// View-layer projection: per-corridor grouping makes the number
    /// human-scannable. Wire format (`.e164`) stays unchanged — this
    /// is purely cosmetic and must never appear in network DTOs.
    func test_displayFormatted_AU_groups_3_3_3() throws {
        let phone = try unwrap(PhoneNumber.parseE164("+61400000000"))
        XCTAssertEqual(phone.displayFormatted, "+61 400 000 000")
    }

    func test_displayFormatted_NG_groups_3_3_4() throws {
        let phone = try unwrap(PhoneNumber.parseE164("+2348012345678"))
        XCTAssertEqual(phone.displayFormatted, "+234 801 234 5678")
    }

    func test_displayFormatted_NZ_groups_2_3_4() throws {
        let phone = try unwrap(PhoneNumber.parseE164("+64211234567"))
        XCTAssertEqual(phone.displayFormatted, "+64 21 123 4567")
    }

    func test_displayFormatted_GB_groups_4_6() throws {
        let phone = try unwrap(PhoneNumber.parseE164("+447700900123"))
        XCTAssertEqual(phone.displayFormatted, "+44 7700 900123")
    }

    func test_displayFormatted_US_groups_3_3_4() throws {
        let phone = try unwrap(PhoneNumber.parseE164("+14155550123"))
        XCTAssertEqual(phone.displayFormatted, "+1 415 555 0123")
    }

    func test_displayFormatted_ZA_groups_2_3_4() throws {
        let phone = try unwrap(PhoneNumber.parseE164("+27821234567"))
        XCTAssertEqual(phone.displayFormatted, "+27 82 123 4567")
    }

    /// Unknown corridor → grouped-3 fallback over the post-`+`
    /// digit run. Covers any dial code not in the curated
    /// `displayGroups` table; defensive default so we never crash
    /// or display a runtime nil in the View.
    func test_displayFormatted_unknownDialCode_fallsBackToGroupedThrees() throws {
        let phone = try unwrap(PhoneNumber.parseE164("+99912345678"))
        XCTAssertEqual(phone.displayFormatted, "+999 123 456 78")
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

    // MARK: - Helpers

    /// Unwraps a `Result<PhoneNumber, ParseError>` for the
    /// displayFormatted tests, which only care about the happy path.
    private func unwrap(
        _ result: Result<PhoneNumber, PhoneNumber.ParseError>,
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws -> PhoneNumber {
        switch result {
        case .success(let phone):
            return phone
        case .failure(let err):
            XCTFail("expected success, got \(err)", file: file, line: line)
            throw err
        }
    }
}
