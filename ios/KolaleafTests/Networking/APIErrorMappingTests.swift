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

    // MARK: - Phase 6 iter-2 (C4 / ADV-P6-C2) typed reasons

    func test_map_recipientNotOwned() {
        XCTAssertEqual(APIError.map(httpStatus: 403, reason: "recipient_not_owned", message: "x"),
                       .recipientNotOwned)
    }

    func test_map_dailyLimitExceeded() {
        XCTAssertEqual(APIError.map(httpStatus: 400, reason: "daily_limit_exceeded", message: "x"),
                       .dailyLimitExceeded)
    }

    func test_map_amountOutOfRange() {
        XCTAssertEqual(APIError.map(httpStatus: 400, reason: "amount_out_of_range", message: "x"),
                       .amountOutOfRange)
    }

    func test_map_invalidCorridor() {
        XCTAssertEqual(APIError.map(httpStatus: 400, reason: "invalid_corridor", message: "x"),
                       .invalidCorridor)
    }

    func test_map_emailUnverified() {
        XCTAssertEqual(APIError.map(httpStatus: 403, reason: "email_unverified", message: "x"),
                       .emailUnverified)
    }

    func test_map_idempotencyKeyConflict() {
        XCTAssertEqual(APIError.map(httpStatus: 409, reason: "idempotency_key_conflict", message: "x"),
                       .idempotencyKeyConflict)
    }

    // MARK: - SendViewModel.mapAPIError: typed-only dispatch

    @MainActor
    func test_sendError_serverMessageText_doesNotDriveDispatch() {
        // iter-1 used substring matching on server messages —
        // "daily_limit" in unrelated server text would have been
        // misread as dailyLimitExceeded. Iter-2 ignores message text.
        let err = APIError.server(
            status: 400,
            message: "stale daily_limit reference in log line; recipient_not_owned trace"
        )
        let mapped = SendViewModel.mapAPIError(err)
        if case .unknown = mapped { /* ok */ } else {
            XCTFail("server-message text must not drive dispatch any more; got \(mapped)")
        }
    }

    // MARK: - Banner sanitiser (defence in depth)

    func test_sanitizer_redactsCuidLikeIdentifier() {
        let raw = "Could not resolve recipient cuser_clidnskd0000001abc12345xx in corridor."
        let sanitized = SendErrorSanitizer.sanitize(raw)
        XCTAssertFalse(sanitized.contains("clidnskd0000001abc12345"),
                       "cuid-looking identifier must be redacted; got: \(sanitized)")
    }

    func test_sanitizer_preservesOrdinaryText() {
        let raw = "We could not contact the bank. Please try again."
        XCTAssertEqual(SendErrorSanitizer.sanitize(raw), raw)
    }
}
