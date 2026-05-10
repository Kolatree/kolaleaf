// APIErrorMappingTests.swift  (Phase 0 · U10)
// Validates APIError.map dispatching across reason codes + HTTP statuses.

import XCTest
@testable import Kolaleaf

final class APIErrorMappingTests: XCTestCase {

    // MARK: - reason-based dispatch

    func test_kycRequiredReason_mapsToKycRequired() {
        let e = APIError.map(httpStatus: 200, reason: "kyc_required", message: nil)
        XCTAssertEqual(e, .kycRequired)
    }

    func test_kycNotVerifiedReason_mapsToKycRequired() {
        let e = APIError.map(httpStatus: 403, reason: "kyc_not_verified", message: nil)
        XCTAssertEqual(e, .kycRequired)
    }

    func test_rateExpiredReason_mapsToRateExpired() {
        let e = APIError.map(httpStatus: 400, reason: "rate_expired", message: nil)
        XCTAssertEqual(e, .rateExpired)
    }

    func test_stepUpRequiredReason_carriesIntent() {
        let e = APIError.map(httpStatus: 401, reason: "stepup_required",
                             message: "transfer.create")
        XCTAssertEqual(e, .stepUpRequired(intent: "transfer.create"))
    }

    func test_stepUpDefaultIntent_whenMessageMissing() {
        let e = APIError.map(httpStatus: 401, reason: "stepup_required", message: nil)
        XCTAssertEqual(e, .stepUpRequired(intent: "transfer.create"))
    }

    func test_bankUnreachableReason() {
        let e = APIError.map(httpStatus: 503, reason: "bank_unreachable", message: nil)
        XCTAssertEqual(e, .bankUnreachable)
    }

    func test_codeInvalidReasons() {
        for r in ["wrong_code", "expired", "used", "no_token"] {
            let e = APIError.map(httpStatus: 400, reason: r, message: nil)
            XCTAssertEqual(e, .codeInvalid(reason: r), "Failed for \(r)")
        }
    }

    // MARK: - status-based dispatch (no reason)

    func test_401_mapsToUnauthorized() {
        XCTAssertEqual(APIError.map(httpStatus: 401, reason: nil, message: nil),
                       .unauthorized)
    }

    func test_402_mapsToKycRequired() {
        XCTAssertEqual(APIError.map(httpStatus: 402, reason: nil, message: nil),
                       .kycRequired)
    }

    func test_403_mapsToForbidden() {
        XCTAssertEqual(APIError.map(httpStatus: 403, reason: nil, message: nil),
                       .forbidden)
    }

    func test_404_mapsToNotFound() {
        XCTAssertEqual(APIError.map(httpStatus: 404, reason: nil, message: nil),
                       .notFound)
    }

    func test_422_mapsToValidation_withFields() {
        let fields = ["email": ["Required"]]
        let e = APIError.map(httpStatus: 422, reason: nil, message: nil, fields: fields)
        XCTAssertEqual(e, .validation(fields: fields))
    }

    func test_429_mapsToRateLimited_honorsRetryAfter() {
        XCTAssertEqual(APIError.map(httpStatus: 429, reason: nil, message: nil,
                                    retryAfter: 30),
                       .rateLimited(retryAfter: 30))
    }

    func test_429_defaultsRetryAfterTo5() {
        XCTAssertEqual(APIError.map(httpStatus: 429, reason: nil, message: nil),
                       .rateLimited(retryAfter: 5))
    }

    func test_5xx_mapsToServer() {
        for status in [500, 502, 503, 599] {
            if case .server(let s, _) = APIError.map(httpStatus: status, reason: nil, message: "boom") {
                XCTAssertEqual(s, status)
            } else {
                XCTFail("\(status) should map to .server")
            }
        }
    }

    // MARK: - precedence

    func test_reason_overrides_status() {
        // 200 with kyc_required reason should still map to kycRequired
        let e = APIError.map(httpStatus: 200, reason: "kyc_required", message: nil)
        XCTAssertEqual(e, .kycRequired)
    }

    func test_unknownReason_fallsThroughToStatus() {
        let e = APIError.map(httpStatus: 500, reason: "snowman", message: "weird")
        if case .server(let s, let msg) = e {
            XCTAssertEqual(s, 500)
            XCTAssertEqual(msg, "weird")
        } else {
            XCTFail("Should map to .server")
        }
    }
}
