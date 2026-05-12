// RecipientResolveServiceTests.swift  (Phase 4 · U37 — iteration 3)
// TDD spec for the debounced NUBAN resolve service.
//
// Behaviour anchors:
//   • A 10-digit accountNumber with a non-empty bankCode triggers a
//     debounced resolve. Anything shorter / non-digit / empty stays
//     idle without hitting the API.
//   • A subsequent resolve while one is in-flight cancels the prior
//     task; only the latest input ever resolves.
//   • 200 → .resolved(accountName)
//   • 404 (notFound)        → .notFound
//   • 503 (server)          → .bankDown
//   • 429 (rateLimited)     → .bankDown
//   • transport / timeout   → .bankDown
//
// Iter-3 (API-202): ResolveState case labels lost the `for`
// preposition. All call sites updated.

import XCTest
@testable import Kolaleaf

@MainActor
final class RecipientResolveServiceTests: XCTestCase {

    // MARK: - Validation gates (no API call expected)

    func test_init_isIdle() {
        let api = FakeAPIClient()
        let svc = RecipientResolveService(api: api)
        XCTAssertEqual(svc.state, .idle)
    }

    func test_partialNuban_doesNotResolve_andStaysIdle() async {
        let api = FakeAPIClient()
        let svc = RecipientResolveService(api: api)

        await svc.resolve(bankCode: "044", accountNumber: "12345") // < 10 digits
        try? await Task.sleep(for: .milliseconds(450))             // past debounce + slack

        XCTAssertEqual(svc.state, .idle)
        let calls = await api.calls
        XCTAssertTrue(calls.isEmpty, "Partial NUBAN must not hit the resolve endpoint")
    }

    func test_emptyBankCode_doesNotResolve() async {
        let api = FakeAPIClient()
        let svc = RecipientResolveService(api: api)

        await svc.resolve(bankCode: "", accountNumber: "0123456789")
        try? await Task.sleep(for: .milliseconds(450))

        XCTAssertEqual(svc.state, .idle)
        let calls = await api.calls
        XCTAssertTrue(calls.isEmpty)
    }

    func test_nonDigitAccountNumber_doesNotResolve() async {
        let api = FakeAPIClient()
        let svc = RecipientResolveService(api: api)

        // 10 chars, but contains a letter — backend's `^\d{10}$` would 422.
        await svc.resolve(bankCode: "044", accountNumber: "012345678a")
        try? await Task.sleep(for: .milliseconds(450))

        XCTAssertEqual(svc.state, .idle)
        let calls = await api.calls
        XCTAssertTrue(calls.isEmpty)
    }

    // MARK: - Happy path

    func test_resolve_200_emitsResolvedWithName() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            RecipientsEndpoints.Resolve.self,
            ResolveRecipientResponse(accountName: "Ada Lovelace")
        )
        let svc = RecipientResolveService(api: api)

        await svc.resolve(bankCode: "044", accountNumber: "0123456789")
        try? await Task.sleep(for: .milliseconds(450))

        XCTAssertEqual(
            svc.state,
            .resolved(name: "Ada Lovelace", bankCode: "044", accountNumber: "0123456789")
        )
    }

    // MARK: - Error mapping

    func test_resolve_404_emitsNotFound() async {
        let api = FakeAPIClient()
        await api.stageFailure(RecipientsEndpoints.Resolve.self, .notFound)
        let svc = RecipientResolveService(api: api)

        await svc.resolve(bankCode: "044", accountNumber: "0123456789")
        try? await Task.sleep(for: .milliseconds(450))

        XCTAssertEqual(
            svc.state,
            .notFound(bankCode: "044", accountNumber: "0123456789")
        )
    }

    func test_resolve_503_emitsBankDown() async {
        let api = FakeAPIClient()
        await api.stageFailure(
            RecipientsEndpoints.Resolve.self,
            .server(status: 503, message: "resolve_unavailable")
        )
        let svc = RecipientResolveService(api: api)

        await svc.resolve(bankCode: "044", accountNumber: "0123456789")
        try? await Task.sleep(for: .milliseconds(450))

        XCTAssertEqual(
            svc.state,
            .bankDown(bankCode: "044", accountNumber: "0123456789", retryAfter: nil)
        )
    }

    func test_resolve_429_emitsBankDown() async {
        let api = FakeAPIClient()
        await api.stageFailure(
            RecipientsEndpoints.Resolve.self,
            .rateLimited(retryAfter: 5)
        )
        let svc = RecipientResolveService(api: api)

        await svc.resolve(bankCode: "044", accountNumber: "0123456789")
        try? await Task.sleep(for: .milliseconds(450))

        XCTAssertEqual(
            svc.state,
            .bankDown(bankCode: "044", accountNumber: "0123456789", retryAfter: 5)
        )
    }

    func test_resolve_transportError_emitsBankDown() async {
        let api = FakeAPIClient()
        await api.stageFailure(
            RecipientsEndpoints.Resolve.self,
            .transport("offline")
        )
        let svc = RecipientResolveService(api: api)

        await svc.resolve(bankCode: "044", accountNumber: "0123456789")
        try? await Task.sleep(for: .milliseconds(450))

        XCTAssertEqual(
            svc.state,
            .bankDown(bankCode: "044", accountNumber: "0123456789", retryAfter: nil)
        )
    }

    // MARK: - Debounce + cancellation

    func test_typingFast_cancelsInflight_onlyResolvesLatest() async {
        let api = FakeAPIClient()
        // Stage a single response for the latest input. If the prior
        // call were not cancelled, it would also consume this same
        // staged result (FakeAPIClient stages by type, not call) — so
        // the absence of a transient `.resolved("First")` followed by
        // `.resolved("Second")` is itself the assertion: the test
        // proves cancellation by counting calls + checking the
        // captured body.
        await api.stageSuccess(
            RecipientsEndpoints.Resolve.self,
            ResolveRecipientResponse(accountName: "Final Holder")
        )
        let svc = RecipientResolveService(api: api)

        // Two rapid calls inside the debounce window. The first should
        // be cancelled before its sleep elapses.
        await svc.resolve(bankCode: "044", accountNumber: "0123456789")
        await svc.resolve(bankCode: "044", accountNumber: "9876543210")
        try? await Task.sleep(for: .milliseconds(500))

        XCTAssertEqual(
            svc.state,
            .resolved(name: "Final Holder", bankCode: "044", accountNumber: "9876543210")
        )
        let calls = await api.calls
        XCTAssertEqual(
            calls.count, 1,
            "Cancellation should leave exactly one resolve hitting the API."
        )
        let body = await api.lastBody(
            for: String(describing: RecipientsEndpoints.Resolve.self),
            as: ResolveRecipientBody.self
        )
        XCTAssertEqual(body?.accountNumber, "9876543210")
    }

    func test_changingBankCode_reResolves() async {
        let api = FakeAPIClient()
        await api.stageSuccess(
            RecipientsEndpoints.Resolve.self,
            ResolveRecipientResponse(accountName: "Holder")
        )
        let svc = RecipientResolveService(api: api)

        await svc.resolve(bankCode: "044", accountNumber: "0123456789")
        try? await Task.sleep(for: .milliseconds(450))
        XCTAssertEqual(
            svc.state,
            .resolved(name: "Holder", bankCode: "044", accountNumber: "0123456789")
        )

        // Same accountNumber, different bank — must re-trigger.
        await svc.resolve(bankCode: "058", accountNumber: "0123456789")
        try? await Task.sleep(for: .milliseconds(450))

        let calls = await api.calls
        XCTAssertEqual(calls.count, 2)
    }

    // MARK: - Iter-3 ADV5-IT2-009: manual-retry debounce

    /// A second `retryNow()` call within `manualRetryMinInterval` of
    /// the previous one must be a no-op so a panicking user tapping
    /// "Retry now" repeatedly cannot rack up upstream calls during
    /// an outage.
    func test_retryNow_debouncesRapidTaps_withinOneSecond() async {
        let api = FakeAPIClient()
        // Stage all 503s so the service stays in `.bankDown` and the
        // manual retry is eligible. Tight retry schedule means the
        // auto-retry doesn't race the manual one.
        await api.stageFailure(
            RecipientsEndpoints.Resolve.self,
            .server(status: 503, message: "down")
        )
        let svc = RecipientResolveService(
            api: api,
            debounce: .milliseconds(20),
            retrySchedule: [10, 20, 40],
            manualRetryMinInterval: 0.20 // 200ms test window
        )
        await svc.resolve(bankCode: "044", accountNumber: "0123456789")
        try? await Task.sleep(for: .milliseconds(60))
        // Should be in `.bankDown` now.
        if case .bankDown = svc.state { /* ok */ } else {
            XCTFail("Expected .bankDown before manual retry, got \(svc.state)")
        }
        let baselineCalls = (await api.calls).count

        // First manual retry — fires.
        await svc.retryNow()
        // Second manual retry within 200ms — must be dropped.
        await svc.retryNow()
        try? await Task.sleep(for: .milliseconds(60))

        let afterCalls = (await api.calls).count
        XCTAssertEqual(
            afterCalls - baselineCalls, 1,
            "Two manual retries within the debounce window must produce only one upstream call. Got \(afterCalls - baselineCalls)."
        )
    }
}
