// KYCDTOTests.swift  (Phase 2 · U25)
// Verifies the iOS DTO + KycStatus enum round-trip the backend's actual
// wire shape. Catches the same class of contract drift the api-contract
// reviewer flagged in Phase 1 (KycInitiateResponse missing accessToken).

import XCTest
@testable import Kolaleaf

final class KYCStatusCodableTests: XCTestCase {

    func test_decodes_all_known_backend_statuses() throws {
        let cases: [(String, KycStatus)] = [
            ("PENDING",   .pending),
            ("IN_REVIEW", .inReview),
            ("VERIFIED",  .verified),
            ("REJECTED",  .rejected),
        ]
        for (raw, expected) in cases {
            let json = "\"\(raw)\"".data(using: .utf8)!
            let decoded = try JSONDecoder().decode(KycStatus.self, from: json)
            XCTAssertEqual(decoded, expected, "Failed for \(raw)")
        }
    }

    func test_decodes_unknown_to_unknown_sentinel() throws {
        let json = "\"FUTURE_STATUS\"".data(using: .utf8)!
        let decoded = try JSONDecoder().decode(KycStatus.self, from: json)
        XCTAssertEqual(decoded, .unknown)
    }

    func test_KycStatusResponse_decodes_minimum_shape() throws {
        let json = #"{"status":"IN_REVIEW"}"#.data(using: .utf8)!
        let decoded = try JSONDecoder().decode(KycStatusResponse.self, from: json)
        XCTAssertEqual(decoded.status, .inReview)
        XCTAssertNil(decoded.applicantId)
    }

    func test_KycStatusResponse_decodes_with_applicantId() throws {
        let json = #"{"status":"VERIFIED","applicantId":"appl_42"}"#.data(using: .utf8)!
        let decoded = try JSONDecoder().decode(KycStatusResponse.self, from: json)
        XCTAssertEqual(decoded.status, .verified)
        XCTAssertEqual(decoded.applicantId, "appl_42")
    }

    func test_KycStatusResponse_ignores_extra_fields() throws {
        // Backend uses .passthrough() — extra keys must not break decoding.
        let json = #"{"status":"PENDING","applicantId":null,"foo":"bar","reasons":[]}"#.data(using: .utf8)!
        let decoded = try JSONDecoder().decode(KycStatusResponse.self, from: json)
        XCTAssertEqual(decoded.status, .pending)
    }

    func test_KycRetryResponse_decodes() throws {
        let json = #"{"accessToken":"tok_x","verificationUrl":"https://sumsub.test/v?t=x"}"#
            .data(using: .utf8)!
        let decoded = try JSONDecoder().decode(KycRetryResponse.self, from: json)
        XCTAssertEqual(decoded.accessToken, "tok_x")
        XCTAssertEqual(decoded.verificationUrl, "https://sumsub.test/v?t=x")
    }
}
