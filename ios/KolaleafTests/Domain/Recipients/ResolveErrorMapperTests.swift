// ResolveErrorMapperTests.swift  (Phase 5 · OO-105)
// Pure-function coverage for the APIError → ResolveState mapper
// extracted out of `RecipientResolveService`. The same expectations
// that lived inline in `RecipientResolveServiceTests` apply here —
// these assert the mapper directly so a future change to the
// service's plumbing can't silently regress the mapping policy.

import XCTest
@testable import Kolaleaf

final class ResolveErrorMapperTests: XCTestCase {

    private let bankCode = "044"
    private let accountNumber = "0123456789"

    func test_notFound_mapsToNotFoundState() {
        let result = ResolveErrorMapper.map(
            .notFound,
            bankCode: bankCode,
            accountNumber: accountNumber
        )
        XCTAssertEqual(
            result,
            .notFound(bankCode: bankCode, accountNumber: accountNumber)
        )
    }

    func test_unauthorized_mapsToSessionExpired() {
        // ADV-003: a 401 must NOT collapse to .bankDown. The
        // user's remedy is to re-auth, not retry.
        let result = ResolveErrorMapper.map(
            .unauthorized,
            bankCode: bankCode,
            accountNumber: accountNumber
        )
        XCTAssertEqual(result, .sessionExpired)
    }

    func test_rateLimited_mapsToBankDown_withRetryHint() {
        let result = ResolveErrorMapper.map(
            .rateLimited(retryAfter: 5),
            bankCode: bankCode,
            accountNumber: accountNumber
        )
        XCTAssertEqual(
            result,
            .bankDown(bankCode: bankCode, accountNumber: accountNumber, retryAfter: 5)
        )
    }

    func test_serverError_mapsToBankDown_noHint() {
        let result = ResolveErrorMapper.map(
            .server(status: 503, message: "down"),
            bankCode: bankCode,
            accountNumber: accountNumber
        )
        XCTAssertEqual(
            result,
            .bankDown(bankCode: bankCode, accountNumber: accountNumber, retryAfter: nil)
        )
    }

    func test_transportError_mapsToBankDown_noHint() {
        let result = ResolveErrorMapper.map(
            .transport("offline"),
            bankCode: bankCode,
            accountNumber: accountNumber
        )
        XCTAssertEqual(
            result,
            .bankDown(bankCode: bankCode, accountNumber: accountNumber, retryAfter: nil)
        )
    }
}
