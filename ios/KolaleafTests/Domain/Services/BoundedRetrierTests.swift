// BoundedRetrierTests.swift  (Phase 5 · OO-101 / CA-004)
// Tests for the standalone BoundedRetrier extracted from
// RecipientResolveService. These exercise the retry policy +
// pause/resume + key-binding contract directly, without standing
// up the resolve service or any network plumbing.
//
// Time compression: the production schedule is `[3, 8, 20]` seconds.
// Tests inject `[0.05, 0.10, 0.20]` so they finish sub-second; the
// schedule semantics are identical, only the wall-clock waits shrink.

import XCTest
@testable import Kolaleaf

private actor FireCounter {
    private var count = 0

    func increment() {
        count += 1
    }

    func value() -> Int {
        count
    }
}

@MainActor
final class BoundedRetrierTests: XCTestCase {

    private static let testSchedule: [TimeInterval] = [0.05, 0.10, 0.20]
    private let key = RetryKey(bankCode: "044", accountNumber: "0123456789")

    // MARK: - Schedule progression

    func test_scheduleNext_firesActionAfterFirstSlot() async {
        let retrier = BoundedRetrier(schedule: Self.testSchedule)
        let exp = expectation(description: "first retry fires")
        retrier.scheduleNext(forKey: key) {
            exp.fulfill()
        }
        await fulfillment(of: [exp], timeout: 0.5)
    }

    func test_scheduleNext_capsAtScheduleLength() async {
        let retrier = BoundedRetrier(schedule: Self.testSchedule)
        let counter = FireCounter()

        for delay in Self.testSchedule {
            retrier.scheduleNext(forKey: key) {
                await counter.increment()
            }
            try? await Task.sleep(for: .seconds(delay + 0.05))
        }
        retrier.scheduleNext(forKey: key) {
            await counter.increment()
        }
        try? await Task.sleep(for: .milliseconds(120))
        let fires = await counter.value()
        XCTAssertEqual(fires, 3, "Retrier must cap at the schedule length (got \(fires) fires).")
        XCTAssertFalse(retrier.canRetry, "canRetry must report false once the cap is hit.")
    }

    // MARK: - Key binding (OO-106)

    func test_scheduleNext_withDifferentKey_resetsAttemptCounter() async {
        let retrier = BoundedRetrier(schedule: Self.testSchedule)
        let counter = FireCounter()
        // Burn 2 attempts on key A.
        retrier.scheduleNext(forKey: key) {
            await counter.increment()
        }
        try? await Task.sleep(for: .milliseconds(80))
        retrier.scheduleNext(forKey: key) {
            await counter.increment()
        }
        try? await Task.sleep(for: .milliseconds(250))
        let fires = await counter.value()
        XCTAssertEqual(fires, 2)
        XCTAssertTrue(retrier.canRetry, "Should still have 1 slot left for key A.")

        // Switch to a new key — counter resets.
        let otherKey = RetryKey(bankCode: "058", accountNumber: "9876543210")
        retrier.scheduleNext(forKey: otherKey) { /* no-op */ }
        XCTAssertTrue(retrier.canRetry, "New key must reset attempt counter.")
    }

    // MARK: - Pause / resume (API-002)

    func test_pause_blocksFutureFires() async {
        let retrier = BoundedRetrier(schedule: Self.testSchedule)
        let counter = FireCounter()
        retrier.scheduleNext(forKey: key) { await counter.increment() }
        retrier.pause()
        try? await Task.sleep(for: .milliseconds(200))
        let fires = await counter.value()
        XCTAssertEqual(fires, 0, "Pause must cancel the pending fire.")
    }

    func test_pause_isIdempotent() async {
        let retrier = BoundedRetrier(schedule: Self.testSchedule)
        let counter = FireCounter()
        retrier.scheduleNext(forKey: key) { await counter.increment() }
        retrier.pause()
        retrier.pause()
        retrier.pause()
        try? await Task.sleep(for: .milliseconds(200))
        let fires = await counter.value()
        XCTAssertEqual(fires, 0)
    }

    func test_resume_reArmsTheTimer() async {
        let retrier = BoundedRetrier(schedule: Self.testSchedule)
        let counter = FireCounter()
        retrier.scheduleNext(forKey: key) { await counter.increment() }
        retrier.pause()
        try? await Task.sleep(for: .milliseconds(120))
        var fires = await counter.value()
        XCTAssertEqual(fires, 0)

        retrier.resume {
            await counter.increment()
        }
        try? await Task.sleep(for: .milliseconds(150))
        fires = await counter.value()
        XCTAssertEqual(fires, 1, "Resume must re-arm the next schedule slot.")
    }

    func test_resume_isIdempotent_doesNotDoubleSchedule() async {
        let retrier = BoundedRetrier(schedule: Self.testSchedule)
        let counter = FireCounter()
        retrier.scheduleNext(forKey: key) { await counter.increment() }
        retrier.pause()
        retrier.resume { await counter.increment() }
        retrier.resume { await counter.increment() }
        retrier.resume { await counter.increment() }
        try? await Task.sleep(for: .milliseconds(200))
        // Multiple resumes overwrite the pending task, so only the
        // LAST resume's action ever fires (single-task ownership).
        let fires = await counter.value()
        XCTAssertEqual(fires, 1, "Repeated resume must replace, not stack.")
    }

    // MARK: - Manual reset (OO-107)

    func test_resetAttemptCounter_restoresFullBudget() async {
        let retrier = BoundedRetrier(schedule: Self.testSchedule)
        let counter = FireCounter()
        // Burn one attempt.
        retrier.scheduleNext(forKey: key) { await counter.increment() }
        try? await Task.sleep(for: .milliseconds(80))
        let fires = await counter.value()
        XCTAssertEqual(fires, 1)

        retrier.resetAttemptCounter()
        XCTAssertTrue(retrier.canRetry, "Counter reset must restore full budget.")
    }

    func test_cancelAll_dropsAllState() async {
        let retrier = BoundedRetrier(schedule: Self.testSchedule)
        let counter = FireCounter()
        retrier.scheduleNext(forKey: key) { await counter.increment() }
        retrier.cancelAll()
        try? await Task.sleep(for: .milliseconds(120))
        let fires = await counter.value()
        XCTAssertEqual(fires, 0)
        XCTAssertFalse(retrier.isBound(toKey: key), "cancelAll must drop the bound key.")
    }

    // MARK: - Initial-delay hint (429 Retry-After)

    func test_scheduleNext_initialDelay_overridesFirstSlot() async {
        let retrier = BoundedRetrier(schedule: [0.30, 0.10, 0.10])
        let start = Date()
        let exp = expectation(description: "first retry honours hint")
        // Hint is 0.05 — must fire FASTER than the 0.30 first slot.
        retrier.scheduleNext(forKey: key, initialDelay: 0.05) {
            exp.fulfill()
        }
        await fulfillment(of: [exp], timeout: 0.5)
        let elapsed = Date().timeIntervalSince(start)
        XCTAssertLessThan(elapsed, 0.20, "First retry must use the 0.05 hint, not the 0.30 schedule slot.")
    }

    // MARK: - Iter-3 ADV5-IT2-002: retry-after clamping

    /// A negative `initialDelay` (server hint) must be clamped to 0
    /// rather than firing immediately AND skipping the schedule slot.
    /// Without the clamp, a malicious/buggy 429 with `Retry-After: -5`
    /// would hammer the backend the moment it fired.
    func test_scheduleNext_clampsNegativeInitialDelay_toZero() async {
        let retrier = BoundedRetrier(schedule: [1.0, 1.0, 1.0])
        let start = Date()
        let exp = expectation(description: "negative hint clamped")
        retrier.scheduleNext(forKey: key, initialDelay: -10.0) {
            exp.fulfill()
        }
        await fulfillment(of: [exp], timeout: 0.5)
        let elapsed = Date().timeIntervalSince(start)
        // Must fire fast (negative clamps to 0) but not via the schedule
        // (1s slot) — so elapsed should be near-zero.
        XCTAssertLessThan(
            elapsed, 0.20,
            "Negative initialDelay must clamp to 0, not fall through to the 1s schedule slot. Elapsed \(elapsed)."
        )
    }

    /// A huge `initialDelay` (e.g. 1 day from a misbehaving server)
    /// must be clamped to `maxRetryAfter` rather than violating the
    /// retrier's bounded time budget.
    func test_scheduleNext_clampsHugeInitialDelay_toMaxRetryAfter() async {
        // maxRetryAfter = 0.10s; schedule slot is irrelevant for this
        // assertion (1.0s — would also be longer than the cap).
        let retrier = BoundedRetrier(schedule: [1.0, 1.0, 1.0], maxRetryAfter: 0.10)
        let start = Date()
        let exp = expectation(description: "huge hint clamped")
        // 86400 seconds = 1 day. Must be clamped to 0.10s.
        retrier.scheduleNext(forKey: key, initialDelay: 86_400) {
            exp.fulfill()
        }
        await fulfillment(of: [exp], timeout: 0.5)
        let elapsed = Date().timeIntervalSince(start)
        XCTAssertLessThan(
            elapsed, 0.40,
            "Huge initialDelay must clamp to maxRetryAfter (0.10s), not actually wait. Elapsed \(elapsed)."
        )
    }

    // MARK: - Iter-3 ADV5-IT2-004: cancelAll preserves paused

    /// `cancelAll()` resets work-item state (currentKey, attempt,
    /// in-flight task) but MUST NOT touch the pause flag. The pause
    /// flag belongs to the scenePhase lifecycle, and a cancellation
    /// triggered by "input changed" must not silently un-pause a
    /// backgrounded retrier.
    func test_cancelAll_doesNotClearPauseFlag() async {
        let retrier = BoundedRetrier(schedule: Self.testSchedule)
        let counter = FireCounter()

        // Bind a key and pause.
        retrier.scheduleNext(forKey: key) { await counter.increment() }
        retrier.pause()
        // cancelAll happens while paused (e.g. input change while
        // app is backgrounded).
        retrier.cancelAll()
        // Schedule a fresh key — should not fire while still paused.
        let newKey = RetryKey(bankCode: "058", accountNumber: "9999999999")
        retrier.scheduleNext(forKey: newKey) { await counter.increment() }
        try? await Task.sleep(for: .milliseconds(200))

        let fires = await counter.value()
        XCTAssertEqual(
            fires, 0,
            "cancelAll() must preserve the paused flag — a fresh schedule while paused must not fire."
        )

        // Confirm the un-pause path works: unpause should now allow
        // a subsequent schedule to fire.
        retrier.unpause()
        retrier.scheduleNext(forKey: newKey) { await counter.increment() }
        try? await Task.sleep(for: .milliseconds(120))
        let firesAfterUnpause = await counter.value()
        XCTAssertGreaterThan(
            firesAfterUnpause, 0,
            "Unpause must restore firing capability."
        )
    }

    // MARK: - Iter-3 OO-201 split: unpause vs resume

    /// `unpause()` clears the pause flag WITHOUT re-arming. Useful
    /// for lifecycle transitions where the current work item is not
    /// retry-eligible (resolved / notFound / sessionExpired).
    func test_unpause_clearsFlagWithoutRearming() async {
        let retrier = BoundedRetrier(schedule: Self.testSchedule)
        let counter = FireCounter()
        retrier.scheduleNext(forKey: key) { await counter.increment() }
        retrier.pause()
        XCTAssertFalse(retrier.canRetry, "paused → !canRetry.")

        retrier.unpause()
        XCTAssertTrue(retrier.canRetry, "unpause must restore canRetry.")
        try? await Task.sleep(for: .milliseconds(200))
        let fires = await counter.value()
        XCTAssertEqual(
            fires, 0,
            "unpause must NOT re-arm; the prior task was cancelled by pause."
        )
    }

    // MARK: - Iter-3 ADV5-IT2-001: isAtCap independent of paused

    func test_isAtCap_isPauseIndependent() async {
        let retrier = BoundedRetrier(schedule: [0.02, 0.02, 0.02])
        let counter = FireCounter()
        // Burn 3 attempts.
        for _ in 0..<3 {
            retrier.scheduleNext(forKey: key) { await counter.increment() }
            try? await Task.sleep(for: .milliseconds(50))
        }
        XCTAssertTrue(retrier.isAtCap, "After 3 fires, must be at cap.")
        XCTAssertFalse(retrier.canRetry, "At cap, canRetry is false.")

        // Pause. isAtCap stays true (it reflects work-item state).
        retrier.pause()
        XCTAssertTrue(
            retrier.isAtCap,
            "isAtCap must be independent of paused — at cap is at cap regardless of lifecycle."
        )
    }
}
