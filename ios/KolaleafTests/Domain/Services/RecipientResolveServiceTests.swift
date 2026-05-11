// RecipientResolveServiceTests.swift  (Phase 4 · U37)
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
// Debounce window is short enough (300ms in production) that tests
// pay only a small wall-clock cost; the alternative — clock injection
// — would be more ceremony than the codebase has elsewhere.

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
            .resolved(name: "Ada Lovelace", forBankCode: "044", forAccountNumber: "0123456789")
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
            .notFound(forBankCode: "044", forAccountNumber: "0123456789")
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
            .bankDown(forBankCode: "044", forAccountNumber: "0123456789", retryAfter: nil)
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
            .bankDown(forBankCode: "044", forAccountNumber: "0123456789", retryAfter: 5)
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
            .bankDown(forBankCode: "044", forAccountNumber: "0123456789", retryAfter: nil)
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
            .resolved(name: "Final Holder", forBankCode: "044", forAccountNumber: "9876543210")
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
            .resolved(name: "Holder", forBankCode: "044", forAccountNumber: "0123456789")
        )

        // Same accountNumber, different bank — must re-trigger.
        await svc.resolve(bankCode: "058", accountNumber: "0123456789")
        try? await Task.sleep(for: .milliseconds(450))

        let calls = await api.calls
        XCTAssertEqual(calls.count, 2)
    }
}
