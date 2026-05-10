// KYCProcessingViewModelTests.swift  (Phase 2 · U25)
// Tests the polling state machine: terminal mapping, retry-on-failure,
// timeout behavior, and unauthorized fast-fail.
//
// Tests inject very short pollIntervalSeconds + small timeoutSeconds so the
// loop ticks quickly without sleeping the test thread for real time.

import XCTest
@testable import Kolaleaf

@MainActor
final class KYCProcessingViewModelTests: XCTestCase {

    // MARK: - Helpers

    private func makeVM(api: AuthAPI) -> KYCProcessingViewModel {
        let vm = KYCProcessingViewModel(api: api)
        vm.pollIntervalSeconds = 0.02
        vm.timeoutSeconds = 5.0
        return vm
    }

    private func waitFor(timeout: TimeInterval = 2.0,
                         _ predicate: @MainActor () -> Bool) async {
        let start = Date()
        while !predicate() && Date().timeIntervalSince(start) < timeout {
            try? await Task.sleep(nanoseconds: 5_000_000)
        }
    }

    // MARK: - Verified terminal

    func test_pollsUntilVerified() async {
        let api = FakeAPIClient()
        await api.stage(KYCEndpoints.Status.self,
                        result: .success(KycStatusResponse(status: .verified)))
        let vm = makeVM(api: api)
        vm.start()

        await waitFor { vm.terminal != nil }
        XCTAssertEqual(vm.terminal, .verified)
        XCTAssertEqual(vm.observedStatus, .verified)
        vm.stop()
    }

    // MARK: - Rejected terminal

    func test_pollsUntilRejected() async {
        let api = FakeAPIClient()
        await api.stage(KYCEndpoints.Status.self,
                        result: .success(KycStatusResponse(status: .rejected)))
        let vm = makeVM(api: api)
        vm.start()

        await waitFor { vm.terminal != nil }
        XCTAssertEqual(vm.terminal, .rejected)
        vm.stop()
    }

    // MARK: - In-review keeps polling

    func test_inReviewStatus_keepsPolling_notTerminal() async {
        let api = FakeAPIClient()
        await api.stage(KYCEndpoints.Status.self,
                        result: .success(KycStatusResponse(status: .inReview)))
        let vm = makeVM(api: api)
        vm.start()

        // Give polling time to tick a few times.
        try? await Task.sleep(nanoseconds: 150_000_000)
        XCTAssertNil(vm.terminal, "in-review must not be terminal")
        XCTAssertGreaterThan(vm.pollAttempts, 1, "should keep polling")
        XCTAssertEqual(vm.observedStatus, .inReview)
        vm.stop()
    }

    // MARK: - Unauthorized → distinct terminal

    func test_unauthorized_setsUnauthorizedTerminal_andStops() async {
        // Phase 2 review fix (P1, correctness CR-6 / reliability rel-4):
        // 401 used to fold into .timedOut, trapping the user behind the
        // under-review screen. Distinct terminal lets the coordinator
        // drive a force-reauth instead.
        let api = FakeAPIClient()
        await api.stage(KYCEndpoints.Status.self,
                        result: .failure(.unauthorized))
        let vm = makeVM(api: api)
        vm.start()

        await waitFor { vm.terminal != nil }
        XCTAssertEqual(vm.terminal, .unauthorized)
        vm.stop()
    }

    // MARK: - Retry-After honored

    func test_rateLimited_recordsErrorButDoesNotResolveTerminal() async {
        // Polling continues after a 429 — the next sleep honors retryAfter
        // (covered by integration; here we assert non-terminal classification).
        let api = FakeAPIClient()
        await api.stage(KYCEndpoints.Status.self,
                        result: .failure(.rateLimited(retryAfter: 30)))
        let vm = makeVM(api: api)
        vm.pollIntervalSeconds = 0.05
        vm.start()

        try? await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertNil(vm.terminal, "rate-limit must NOT terminate the loop")
        XCTAssertNotNil(vm.lastError)
        vm.stop()
    }

    // MARK: - pause / resume

    func test_pause_then_resume_keepsPolling() async {
        let api = FakeAPIClient()
        await api.stage(KYCEndpoints.Status.self,
                        result: .success(KycStatusResponse(status: .inReview)))
        let vm = makeVM(api: api)
        vm.start()
        try? await Task.sleep(nanoseconds: 50_000_000)
        let attemptsBeforePause = vm.pollAttempts
        vm.pause()
        try? await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(vm.pollAttempts, attemptsBeforePause,
                       "no polls should happen while paused")
        vm.resume()
        try? await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertGreaterThan(vm.pollAttempts, attemptsBeforePause,
                             "polling should resume after resume()")
        vm.stop()
    }

    func test_resume_isNoOp_whenAlreadyTerminal() async {
        let api = FakeAPIClient()
        await api.stage(KYCEndpoints.Status.self,
                        result: .success(KycStatusResponse(status: .verified)))
        let vm = makeVM(api: api)
        vm.start()
        await waitFor { vm.terminal != nil }
        let attemptsAtTerminal = vm.pollAttempts
        vm.resume()
        try? await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(vm.pollAttempts, attemptsAtTerminal,
                       "resume after terminal must be a no-op")
    }

    // MARK: - Transient error retries

    func test_transientFailure_increasesConsecutiveFailures_keepsPolling() async {
        let api = FakeAPIClient()
        await api.stage(KYCEndpoints.Status.self,
                        result: .failure(.transport("offline")))
        let vm = makeVM(api: api)
        vm.start()

        try? await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertNil(vm.terminal)
        XCTAssertGreaterThan(vm.consecutiveFailures, 0)
        XCTAssertNotNil(vm.lastError)
        vm.stop()
    }

    // MARK: - Timeout

    func test_timesOut_whenStatusNeverResolves() async {
        let api = FakeAPIClient()
        await api.stage(KYCEndpoints.Status.self,
                        result: .success(KycStatusResponse(status: .inReview)))
        let vm = makeVM(api: api)
        vm.timeoutSeconds = 0.1     // very short timeout
        vm.start()

        await waitFor(timeout: 3.0) { vm.terminal != nil }
        XCTAssertEqual(vm.terminal, .timedOut)
        vm.stop()
    }

    // MARK: - stop is idempotent

    func test_stop_isIdempotent() async {
        let api = FakeAPIClient()
        await api.stage(KYCEndpoints.Status.self,
                        result: .success(KycStatusResponse(status: .inReview)))
        let vm = makeVM(api: api)
        vm.start()
        vm.stop()
        vm.stop()
        // No crash — pass.
    }
}
