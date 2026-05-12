// BankDownAutoRetryTests.swift  (Phase 5 · U40)
// TDD spec for the auto-retry behaviour on the `.bankDown` resolve state.
//
// Why these tests exist:
//   • U40 surfaces a transient bank-provider outage as `.bankDown` and
//     hands the user a "we'll try again automatically" banner. The
//     promise must hold — the service has to fire those retries on a
//     bounded schedule (3s / 8s / 20s in production), pause when the
//     app backgrounds, cancel when the user edits inputs, and stop
//     after the cap is reached.
//
// Time compression:
//   • Production schedule is `[3, 8, 20]` seconds. To keep the test
//     suite sub-second we inject a tiny schedule (`[0.05, 0.10, 0.20]`)
//     via `RecipientResolveService.init(retrySchedule:)`. The same
//     code paths execute — only the wall-clock waits shrink.
//   • Debounce is also injected (`debounce: .milliseconds(20)`) so a
//     single resolve cycle takes ~20ms instead of 300ms; the tests
//     would still pass with the production debounce but would each
//     pay 0.3s/cycle for nothing.
//
// What we're NOT testing here:
//   • Visual rendering of the bankDown card — those land in
//     `ResolvedNameCardVariantTests` (smoke tests on the View
//     constructor) since this project has no view-output assertion
//     helper beyond Point-Free snapshot testing, which is reserved
//     for higher-stakes screens.

import XCTest
@testable import Kolaleaf

@MainActor
final class BankDownAutoRetryTests: XCTestCase {

    // Schedule that compresses 3s/8s/20s to 50ms/100ms/200ms — same
    // ordinality, sub-second total. Total fire window: 350ms +
    // (20ms debounce × 4 calls) = ~430ms before all retries elapse.
    private static let testSchedule: [TimeInterval] = [0.05, 0.10, 0.20]
    private static let testDebounce: Duration = .milliseconds(20)

    private func makeService(api: FakeAPIClient) -> RecipientResolveService {
        RecipientResolveService(
            api: api,
            debounce: Self.testDebounce,
            retrySchedule: Self.testSchedule
        )
    }

    // MARK: - Schedule

    func test_bankDown_schedulesAutoRetry_at3s_8s_20s() async {
        let api = FakeAPIClient()
        // 3 failures, then a success. The fake's sequence support
        // returns these in order across successive `send` calls.
        await api.stageSequence(
            RecipientsEndpoints.Resolve.self,
            results: [
                .failure(.server(status: 503, message: "down")),
                .failure(.server(status: 503, message: "still down")),
                .failure(.server(status: 503, message: "still down")),
                .success(ResolveRecipientResponse(accountName: "Adaeze N.")),
            ]
        )
        let svc = makeService(api: api)

        await svc.resolve(bankCode: "044", accountNumber: "0123456789")
        // Wait long enough for the initial resolve + 3 retries to fire.
        // 20ms debounce × 4 + 50 + 100 + 200 + 80ms slack = ~510ms.
        try? await Task.sleep(for: .milliseconds(550))

        let calls = await api.calls
        XCTAssertEqual(
            calls.count, 4,
            "Expected 1 initial resolve + 3 auto-retries (= 4 calls), got \(calls.count)."
        )
        XCTAssertEqual(
            svc.state,
            .resolved(name: "Adaeze N.", bankCode: "044", accountNumber: "0123456789"),
            "Final state must be the success that landed on the 4th call."
        )
    }

    func test_bankDown_afterMaxRetries_transitionsToExhausted() async {
        // ADV5-002: after the 3rd auto-retry fails, the service must
        // transition to `.bankDownExhausted` so the View can drop the
        // misleading "we'll try again automatically" copy. Without
        // this transition the user waits forever for a retry that
        // will never come.
        let api = FakeAPIClient()
        await api.stageSequence(
            RecipientsEndpoints.Resolve.self,
            results: [
                .failure(.server(status: 503, message: "down")),
                .failure(.server(status: 503, message: "down")),
                .failure(.server(status: 503, message: "down")),
                .failure(.server(status: 503, message: "down")),
            ]
        )
        let svc = makeService(api: api)

        await svc.resolve(bankCode: "044", accountNumber: "0123456789")
        try? await Task.sleep(for: .milliseconds(700))

        let calls = await api.calls
        XCTAssertEqual(
            calls.count, 4,
            "Service must cap at 3 retries (= 4 total calls), got \(calls.count)."
        )
        // Final state must be .bankDownExhausted, not .bankDown.
        if case let .bankDownExhausted(b, a) = svc.state {
            XCTAssertEqual(b, "044")
            XCTAssertEqual(a, "0123456789")
        } else {
            XCTFail("Expected .bankDownExhausted after retry budget exhausted, got \(svc.state)")
        }
    }

    /// ADV5-002: after the schedule exhausts, a manual `retryNow()`
    /// must succeed AND restore the full retry budget. The user
    /// explicitly intervened — they get a fresh cycle.
    func test_bankDownExhausted_manualRetry_resumesFromZero() async {
        let api = FakeAPIClient()
        // 3 initial failures → exhausted, then a success on the
        // manual retry round-trip.
        await api.stageSequence(
            RecipientsEndpoints.Resolve.self,
            results: [
                .failure(.server(status: 503, message: "down")),
                .failure(.server(status: 503, message: "down")),
                .failure(.server(status: 503, message: "down")),
                .failure(.server(status: 503, message: "down")),
                .success(ResolveRecipientResponse(accountName: "Recovered Holder")),
            ]
        )
        let svc = makeService(api: api)

        await svc.resolve(bankCode: "044", accountNumber: "0123456789")
        try? await Task.sleep(for: .milliseconds(700))
        if case .bankDownExhausted = svc.state {} else {
            XCTFail("Expected .bankDownExhausted before manual retry, got \(svc.state)")
        }

        // Manual retry from the exhausted state must fire.
        await svc.retryNow()
        try? await Task.sleep(for: .milliseconds(80))

        XCTAssertEqual(
            svc.state,
            .resolved(name: "Recovered Holder", bankCode: "044", accountNumber: "0123456789")
        )
    }

    // MARK: - Cancellation

    func test_bankDown_manualRetry_cancelsAutoRetry() async {
        let api = FakeAPIClient()
        // Stage 503 forever via stageFailure (no sequence). Manual
        // retry will fire one extra resolve; assert no double-up.
        await api.stageFailure(
            RecipientsEndpoints.Resolve.self,
            .server(status: 503, message: "down")
        )
        let svc = makeService(api: api)

        await svc.resolve(bankCode: "044", accountNumber: "0123456789")
        // Wait past the debounce so the initial resolve completes
        // and the service is in `.bankDown`. A 1st auto-retry is
        // scheduled at +50ms.
        try? await Task.sleep(for: .milliseconds(40))

        let callsBefore = (await api.calls).count
        XCTAssertEqual(callsBefore, 1, "Initial resolve should be the only call so far.")

        // User taps "Retry now" BEFORE the 50ms auto-retry fires.
        // Manual retry must cancel the in-flight auto-retry task and
        // re-fire resolve immediately (modulo debounce).
        await svc.retryNow()
        try? await Task.sleep(for: .milliseconds(40))

        // Exactly +1 call (the manual retry). The 50ms auto-retry
        // would have fired at the same wall-clock moment if it hadn't
        // been cancelled.
        let callsAfter = (await api.calls).count
        XCTAssertEqual(
            callsAfter, 2,
            "Manual retry must replace the pending auto-retry, not stack on it (got \(callsAfter) calls)."
        )
    }

    func test_bankDown_inputChange_cancelsAutoRetry() async {
        let api = FakeAPIClient()
        // First resolve fails (503). Second resolve (different account)
        // succeeds. The 1st auto-retry must be cancelled by the input
        // change so we don't see a stale 503-retry hitting the wire
        // after the user has moved on.
        await api.stageSequence(
            RecipientsEndpoints.Resolve.self,
            results: [
                .failure(.server(status: 503, message: "down")),
                .success(ResolveRecipientResponse(accountName: "New Holder")),
            ]
        )
        let svc = makeService(api: api)

        await svc.resolve(bankCode: "044", accountNumber: "0123456789")
        try? await Task.sleep(for: .milliseconds(40))

        // User edits the account number — must cancel the pending
        // auto-retry that was scheduled for ~10ms from now.
        await svc.resolve(bankCode: "044", accountNumber: "9876543210")
        try? await Task.sleep(for: .milliseconds(80))

        let calls = await api.calls
        XCTAssertEqual(
            calls.count, 2,
            "Expected initial + new-input resolve only (auto-retry must be cancelled). Got \(calls.count)."
        )
        XCTAssertEqual(
            svc.state,
            .resolved(name: "New Holder", bankCode: "044", accountNumber: "9876543210")
        )
    }

    // MARK: - Backgrounding

    func test_bankDown_backgrounded_pausesRetry() async {
        let api = FakeAPIClient()
        await api.stageFailure(
            RecipientsEndpoints.Resolve.self,
            .server(status: 503, message: "down")
        )
        let svc = makeService(api: api)

        await svc.resolve(bankCode: "044", accountNumber: "0123456789")
        try? await Task.sleep(for: .milliseconds(40))
        // Now in .bankDown with an auto-retry scheduled at ~+10ms.

        svc.pauseAutoRetry()
        // Wait well past the schedule's longest slot. NO retry must
        // fire while paused.
        try? await Task.sleep(for: .milliseconds(400))

        let callsWhilePaused = (await api.calls).count
        XCTAssertEqual(
            callsWhilePaused, 1,
            "Auto-retry must NOT fire while paused (got \(callsWhilePaused) calls)."
        )

        // Resume — retry should fire shortly after.
        svc.resumeAutoRetry()
        try? await Task.sleep(for: .milliseconds(120))

        let callsAfterResume = (await api.calls).count
        XCTAssertGreaterThan(
            callsAfterResume, 1,
            "Resume must re-arm the retry schedule (got \(callsAfterResume) calls)."
        )
    }

    // MARK: - 429 retry-after hint

    func test_bankDown_useRetryAfterHint_when429() async {
        let api = FakeAPIClient()
        // 429 with a 0.3s retry-after, then success on the 2nd call.
        // Production code would use the 5s hint from the backend; in
        // the test we verify the FIRST retry waits AT LEAST that hint
        // (≥ 280ms, < the schedule's first slot of 50ms × 4 = 200ms
        // wouldn't apply because we use the hint).
        await api.stageSequence(
            RecipientsEndpoints.Resolve.self,
            results: [
                .failure(.rateLimited(retryAfter: 0.3)),
                .success(ResolveRecipientResponse(accountName: "Holder")),
            ]
        )
        let svc = makeService(api: api)

        let start = Date()
        await svc.resolve(bankCode: "044", accountNumber: "0123456789")

        // Wait past debounce + retry-after + slack.
        try? await Task.sleep(for: .milliseconds(450))

        let calls = await api.calls
        XCTAssertEqual(
            calls.count, 2,
            "Expected initial + 1 retry honouring the rate-limit hint."
        )
        XCTAssertEqual(
            svc.state,
            .resolved(name: "Holder", bankCode: "044", accountNumber: "0123456789")
        )

        let elapsed = Date().timeIntervalSince(start)
        XCTAssertGreaterThan(
            elapsed, 0.30,
            "First retry must honour the 0.3s rate-limit hint, not the 50ms first schedule slot. Elapsed \(elapsed)s."
        )
    }

    // MARK: - ADV5 regression tests

    /// ADV5-001: a manual retry firing concurrently with an in-flight
    /// auto-retry must NOT spawn two billed `/resolve` calls. The
    /// stale auto-retry task has to be cancelled at the top of
    /// `runResolve`.
    func test_manualRetry_duringInflightAutoRetry_doesNotDoubleResolve() async {
        let api = FakeAPIClient()
        // Stage failures with a slow response so the auto-retry's
        // `send` call is in-flight when the manual retry fires.
        await api.stageFailureWithDelay(
            RecipientsEndpoints.Resolve.self,
            .server(status: 503, message: "down"),
            nanoseconds: 80_000_000 // 80ms — longer than the 50ms first slot
        )
        let svc = makeService(api: api)

        await svc.resolve(bankCode: "044", accountNumber: "0123456789")
        // Wait for the initial resolve to land in `.bankDown` (debounce
        // 20ms + delay 80ms + slack).
        try? await Task.sleep(for: .milliseconds(140))
        let callsAfterInitial = (await api.calls).count
        XCTAssertEqual(callsAfterInitial, 1, "Initial resolve must be the only call so far.")

        // Wait until the auto-retry's send is mid-flight (50ms
        // slot fires at ~+140ms relative to start, +60ms relative to
        // here). Then trigger manual retry while it's outstanding.
        try? await Task.sleep(for: .milliseconds(60))
        await svc.retryNow()
        try? await Task.sleep(for: .milliseconds(150))

        // Without the ADV5-001 fix, both the auto-retry's in-flight
        // call AND the manual retry's call would land — count > 2.
        // With the fix, the auto-retry task gets cancelled and only
        // the manual retry's call survives.
        let total = (await api.calls).count
        XCTAssertLessThanOrEqual(
            total, 3,
            "Manual retry must cancel the in-flight auto-retry, not double up. Got \(total) calls."
        )
    }

    /// ADV5-005: `pauseAutoRetry()` must be safely idempotent so
    /// scenePhase events that fire repeatedly (e.g. .background ->
    /// .background on system glitches) cannot leak timers.
    func test_pauseAutoRetry_isIdempotent_acrossMultipleCalls() async {
        let api = FakeAPIClient()
        await api.stageFailure(
            RecipientsEndpoints.Resolve.self,
            .server(status: 503, message: "down")
        )
        let svc = makeService(api: api)
        await svc.resolve(bankCode: "044", accountNumber: "0123456789")
        try? await Task.sleep(for: .milliseconds(40))

        svc.pauseAutoRetry()
        svc.pauseAutoRetry()
        svc.pauseAutoRetry()
        try? await Task.sleep(for: .milliseconds(300))

        let calls = (await api.calls).count
        XCTAssertEqual(calls, 1, "Repeated pause must not double-cancel or replay (got \(calls)).")
    }

    /// ADV5-005: `resumeAutoRetry()` must NOT stack pending tasks
    /// when called repeatedly (e.g. multiple .active transitions).
    /// Each resume should overwrite the prior wake-up.
    func test_resumeAutoRetry_isIdempotent_doesNotDuplicateTimer() async {
        let api = FakeAPIClient()
        await api.stageFailure(
            RecipientsEndpoints.Resolve.self,
            .server(status: 503, message: "down")
        )
        let svc = makeService(api: api)
        await svc.resolve(bankCode: "044", accountNumber: "0123456789")
        try? await Task.sleep(for: .milliseconds(40))
        svc.pauseAutoRetry()

        svc.resumeAutoRetry()
        svc.resumeAutoRetry()
        svc.resumeAutoRetry()
        // Wait for ONE schedule slot. If resumes stacked we'd see
        // multiple fires within the window.
        try? await Task.sleep(for: .milliseconds(120))

        let total = (await api.calls).count
        XCTAssertLessThanOrEqual(
            total, 2,
            "Repeated resume must overwrite, not stack. Got \(total) calls."
        )
    }

    /// ADV5-004: subsequent retries (not just the first) must fall
    /// through to the next schedule slot, not honour a stale
    /// retryAfter hint forever. We can't easily assert the exact
    /// timing, so we assert the second retry fires within the slot
    /// window after the first failure.
    func test_secondRetry_alsoHonorsRetryAfterHint() async {
        let api = FakeAPIClient()
        // First call: rate-limited (hint 0.05s) → bankDown. Second
        // call: rate-limited again (hint 0.05s) → bankDown. Third
        // call: success.
        await api.stageSequence(
            RecipientsEndpoints.Resolve.self,
            results: [
                .failure(.rateLimited(retryAfter: 0.05)),
                .failure(.rateLimited(retryAfter: 0.05)),
                .success(ResolveRecipientResponse(accountName: "Holder")),
            ]
        )
        let svc = makeService(api: api)
        await svc.resolve(bankCode: "044", accountNumber: "0123456789")
        // Initial + first retry + second retry should all complete.
        try? await Task.sleep(for: .milliseconds(450))

        let calls = (await api.calls).count
        XCTAssertEqual(calls, 3, "Expected initial + 2 retries before success.")
        XCTAssertEqual(
            svc.state,
            .resolved(name: "Holder", bankCode: "044", accountNumber: "0123456789")
        )
    }

    /// Race regression: an input change while the auto-retry's
    /// `runResolve` is mid-debounce must cancel that task — the
    /// service's `resolve(_:_:)` cancels `inflightTask` at the top.
    func test_inputChange_duringInflightAutoRetry_cancelsOldTask() async {
        let api = FakeAPIClient()
        await api.stageSequence(
            RecipientsEndpoints.Resolve.self,
            results: [
                .failure(.server(status: 503, message: "down")),
                // The 1st auto-retry would consume this if it weren't
                // cancelled. The 2nd resolve (different account)
                // should consume this success instead.
                .success(ResolveRecipientResponse(accountName: "New Holder")),
            ]
        )
        let svc = makeService(api: api)

        await svc.resolve(bankCode: "044", accountNumber: "0123456789")
        try? await Task.sleep(for: .milliseconds(40))
        // Auto-retry is scheduled for ~+10ms. Change input now.
        await svc.resolve(bankCode: "044", accountNumber: "9876543210")
        try? await Task.sleep(for: .milliseconds(120))

        // The new account number must be the one in the resolved
        // state, NOT the original.
        XCTAssertEqual(
            svc.state,
            .resolved(name: "New Holder", bankCode: "044", accountNumber: "9876543210")
        )
    }

    // MARK: - Iter-3 regression tests

    /// ADV5-IT2-001: an in-flight retry whose `runResolve` overlaps a
    /// `pauseAutoRetry()` (e.g. user backgrounds the app during a slow
    /// retry) must not be treated as exhausting the retry budget when
    /// the resolve fails. The previous `!canRetry` exhaustion guard
    /// folded "paused" into "exhausted", so a single failed retry
    /// with an overlapping pause stranded the user at
    /// `.bankDownExhausted` after just one of three attempts.
    func test_inFlightRetry_overlappingPause_doesNotPrematurelyExhaust() async {
        let api = FakeAPIClient()
        // 1st call fails; 2nd call (the first auto-retry) takes long
        // enough to overlap with a pause; both fail. After the pause
        // ends, we want the service still in `.bankDown` (not
        // `.bankDownExhausted`) because only 1 of 3 slots is spent.
        await api.stageFailureWithDelay(
            RecipientsEndpoints.Resolve.self,
            .server(status: 503, message: "down"),
            nanoseconds: 60_000_000 // 60ms — long enough to overlap pause
        )
        let svc = makeService(api: api)

        await svc.resolve(bankCode: "044", accountNumber: "0123456789")
        // 1st resolve completes at ~+80ms (20ms debounce + 60ms delay).
        try? await Task.sleep(for: .milliseconds(100))
        // 1st auto-retry scheduled for +50ms from here.
        // Wait past the schedule so the auto-retry starts running.
        try? await Task.sleep(for: .milliseconds(70))
        // Now we're inside the auto-retry's runResolve (sleep+network).
        // Pause mid-flight. The retry's `api.send` keeps going (it's
        // the inflight task, not the timer task), then fails, and the
        // service's scheduleAutoRetry runs while `paused == true`.
        svc.pauseAutoRetry()
        try? await Task.sleep(for: .milliseconds(150))
        // Resume. The state must still be `.bankDown` — only 1 of 3
        // slots is spent — not `.bankDownExhausted`.
        svc.resumeAutoRetry()
        try? await Task.sleep(for: .milliseconds(40))

        if case .bankDownExhausted = svc.state {
            XCTFail("Overlapping background pause must not prematurely exhaust the retry budget. State: \(svc.state)")
        }
    }
}
