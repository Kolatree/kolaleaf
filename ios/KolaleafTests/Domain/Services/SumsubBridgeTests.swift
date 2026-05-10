// SumsubBridgeTests.swift  (Phase 2 · U24c)
// Pure-function tests for the Sumsub result → KycStatus + route mapping.

import XCTest
@testable import Kolaleaf

final class SumsubBridgeTests: XCTestCase {

    // MARK: - Submitted

    func test_submitted_optimisticallyMovesToInReview_andRoutesToProcessing() {
        let d = SumsubBridge.decide(result: .submitted, currentStatus: .pending)
        XCTAssertEqual(d.optimisticStatus, .inReview)
        XCTAssertEqual(d.nextRoute, .processing)
        XCTAssertNil(d.userMessage)
    }

    // MARK: - Verdict

    func test_verdictGreen_optimisticallyMovesToVerified_andRoutesToVerified() {
        let d = SumsubBridge.decide(result: .verdict(answer: "GREEN"), currentStatus: .inReview)
        XCTAssertEqual(d.optimisticStatus, .verified)
        XCTAssertEqual(d.nextRoute, .verified)
    }

    func test_verdictRed_optimisticallyMovesToRejected_andRoutesToRetryFromIntro() {
        let d = SumsubBridge.decide(result: .verdict(answer: "RED"), currentStatus: .inReview)
        XCTAssertEqual(d.optimisticStatus, .rejected)
        XCTAssertEqual(d.nextRoute, .retryFromIntro)
    }

    func test_verdictGreen_isCaseInsensitive() {
        let d = SumsubBridge.decide(result: .verdict(answer: "green"), currentStatus: .inReview)
        XCTAssertEqual(d.optimisticStatus, .verified)
    }

    func test_verdictUnknown_fallsBackToInReviewAndProcessing() {
        let d = SumsubBridge.decide(result: .verdict(answer: "YELLOW"), currentStatus: .inReview)
        XCTAssertEqual(d.optimisticStatus, .inReview)
        XCTAssertEqual(d.nextRoute, .processing)
    }

    // MARK: - Cancelled

    func test_cancelled_preservesCurrentStatus_andRoutesBackToIntro() {
        let d = SumsubBridge.decide(result: .cancelled, currentStatus: .pending)
        XCTAssertEqual(d.optimisticStatus, .pending)
        XCTAssertEqual(d.nextRoute, .retryFromIntro)
        XCTAssertNil(d.userMessage)
    }

    func test_cancelled_fromInReview_keepsInReview() {
        let d = SumsubBridge.decide(result: .cancelled, currentStatus: .inReview)
        XCTAssertEqual(d.optimisticStatus, .inReview)
    }

    // MARK: - Failed

    func test_failed_preservesCurrentStatus_surfacesMessage() {
        let d = SumsubBridge.decide(
            result: .failed(code: "TOKEN_EXPIRED", message: "Session expired"),
            currentStatus: .pending
        )
        XCTAssertEqual(d.optimisticStatus, .pending)
        XCTAssertEqual(d.nextRoute, .retryFromIntro)
        XCTAssertEqual(d.userMessage, "Session expired")
    }

    func test_failed_emptyMessage_fillsGenericCopy() {
        let d = SumsubBridge.decide(
            result: .failed(code: "NETWORK", message: ""),
            currentStatus: .pending
        )
        XCTAssertNotNil(d.userMessage)
        XCTAssertFalse(d.userMessage?.isEmpty ?? true)
    }
}
