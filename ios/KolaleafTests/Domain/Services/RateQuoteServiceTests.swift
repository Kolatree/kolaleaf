// RateQuoteServiceTests.swift  (Phase 6 iter-2 · C1 / OO-001)
// Pins the rate-quote service contract that was previously baked
// into the SendViewModel god-class.

import XCTest
@testable import Kolaleaf

@MainActor
final class RateQuoteServiceTests: XCTestCase {

    private func ratesResponse(
        ageSeconds: TimeInterval = 60,
        rate: String = "1050.25"
    ) -> RatePublicResponse {
        RatePublicResponse(
            baseCurrency: "AUD",
            targetCurrency: "NGN",
            corridorId: "corridor_au_ng",
            customerRate: rate,
            effectiveAt: Date().addingTimeInterval(-ageSeconds)
        )
    }

    func test_loadRate_success_populatesQuote() async {
        let api = FakeAPIClient()
        await api.stageSuccess(RatesEndpoints.Quote.self, ratesResponse())
        let svc = RateQuoteService(api: api)

        let result = await svc.loadRate()

        XCTAssertNotNil(svc.quote)
        XCTAssertEqual(svc.quote?.corridorId, "corridor_au_ng")
        XCTAssertEqual(svc.quote?.customerRate, Decimal(string: "1050.25"))
        if case .success = result { /* ok */ } else {
            XCTFail("expected success, got \(result)")
        }
    }

    func test_loadRate_failure_setsLastLoadFailed() async {
        let api = FakeAPIClient()
        await api.stageFailure(RatesEndpoints.Quote.self, .transport("offline"))
        let svc = RateQuoteService(api: api)

        let result = await svc.loadRate()

        XCTAssertNil(svc.quote)
        XCTAssertTrue(svc.lastLoadFailed)
        if case .failure = result { /* ok */ } else {
            XCTFail("expected failure, got \(result)")
        }
    }

    func test_isFresh_falseWhenNoQuote() {
        let svc = RateQuoteService(api: FakeAPIClient())
        XCTAssertFalse(svc.isFresh())
    }

    func test_isFresh_trueForFreshQuote() async {
        let api = FakeAPIClient()
        await api.stageSuccess(RatesEndpoints.Quote.self, ratesResponse(ageSeconds: 60))
        let svc = RateQuoteService(api: api)
        await svc.loadRate()
        XCTAssertTrue(svc.isFresh())
    }

    func test_isStale_pastThreshold() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            RatesEndpoints.Quote.self,
            ratesResponse(ageSeconds: 13 * 60 * 60)
        )
        let svc = RateQuoteService(api: api)
        await svc.loadRate()
        XCTAssertFalse(svc.isFresh())
    }

    func test_malformedRateString_treatedAsDecodeFailure() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            RatesEndpoints.Quote.self,
            RatePublicResponse(
                baseCurrency: "AUD",
                targetCurrency: "NGN",
                corridorId: "corridor_au_ng",
                customerRate: "not-a-number",
                effectiveAt: Date()
            )
        )
        let svc = RateQuoteService(api: api)
        let result = await svc.loadRate()
        if case .failure(let err) = result, case .decode = err {
            // ok
        } else {
            XCTFail("expected .decode failure, got \(result)")
        }
        XCTAssertNil(svc.quote)
    }
}
