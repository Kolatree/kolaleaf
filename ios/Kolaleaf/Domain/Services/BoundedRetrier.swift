// BoundedRetrier.swift  (Phase 5 · OO-101 / CA-004 — iteration 3)
// Tiny, single-responsibility retry collaborator extracted from
// `RecipientResolveService`. The service used to mix three orthogonal
// concerns: debounced dispatch, retry policy state, lifecycle pause/
// resume. SRP violation. This type owns ONLY the retry policy +
// timer + pause/resume — the service composes it.
//
// Why a dedicated type rather than a couple of fields on the service:
//   • Lets the service describe itself in domain terms ("on bankDown
//     I delegate to a bounded retrier") instead of bookkeeping
//     timer fields and attempt counters inline.
//   • Pause/resume + cancellation now have one home; the service no
//     longer has to remember to also nil the attempt counter
//     whenever it cancels the timer.
//   • Tested in isolation against a pure schedule contract — no
//     network, no API actor, no domain plumbing.
//
// OO-106 fix integrated: the attempt counter is bound to the
// (bankCode, accountNumber) tuple it was started for. A new
// `scheduleNext(forKey:)` resets the counter when the key differs.
// The service no longer has to remember to zero the counter on
// input change — the structural binding makes the invariant
// impossible to violate by discipline.
//
// Iteration 3 fixes:
//   • OO-201 / API-201 — `resume(action:)` no longer silently drops
//     its action argument. The surface splits into `unpause()` (just
//     clears the pause flag, no action) and `resume(action:)` (clears
//     the flag AND re-arms). Callers say what they mean.
//   • OO-204 — schedule path deduplicated. Both the first `scheduleNext`
//     and the resume path now feed `scheduleNextInternal`, so there is
//     ONE Task-building site to audit.
//   • ADV5-IT2-001 — `isAtCap` reports cap exhaustion independent of
//     the paused flag, so a backgrounded retrier mid-flight no longer
//     looks "exhausted" to a scheduleNext-after-failure path that
//     decides whether to promote to `.bankDownExhausted`.
//   • ADV5-IT2-002 — `initialDelay` hints from the server are clamped
//     to `[0, maxRetryAfter]`. A buggy/malicious server returning a
//     negative or hours-long `Retry-After` cannot violate the
//     retrier's own time budget. Defense-in-depth: APIClient also
//     clamps the parsed value to ≥ 0 at parse time.
//   • ADV5-IT2-004 — `cancelAll()` drops only work-item state
//     (currentKey, attempt, in-flight task). The `paused` flag
//     belongs to lifecycle, not work-item state; cancellation must
//     never silently un-pause.
//   • ADV5-IT2-007 — empty `schedule: []` would silently disable
//     auto-retry. A `precondition` in `init` makes the misuse fail
//     loudly at startup instead of producing a quiet retrier that
//     never fires.
//   • ADV5-IT2-010 — `attempt` is incremented AFTER the action runs,
//     not BEFORE. Cancellation during sleep no longer burns a slot.
//
// Threading: `@MainActor`-isolated. The retrier is owned by the
// MainActor-isolated service; the timer task hops back to MainActor
// before invoking the action, so callers don't have to think about
// re-entry from arbitrary threads.

import Foundation

/// Single key under which a retry sequence is bound. Two retries
/// with different keys are treated as belonging to different work
/// items: scheduling the second resets the attempt counter.
///
/// Iter-3 (API-203): the fields are named for the recipient subdomain
/// since that's the only caller today. Inlining the language reads
/// naturally at the use site (`RetryKey(bankCode:accountNumber:)`)
/// without paying for premature generality. If a second caller
/// materialises later, swap to a generic struct then — until then
/// we don't pre-pay for flexibility we don't use.
public struct RetryKey: Sendable, Equatable, Hashable {
    public let bankCode: String
    public let accountNumber: String

    public init(bankCode: String, accountNumber: String) {
        self.bankCode = bankCode
        self.accountNumber = accountNumber
    }
}

/// Bounded, pausable, key-bound retry timer. Owns one Task at a time;
/// scheduling a new wake-up cancels the prior one.
@MainActor
public final class BoundedRetrier {

    /// Production retry schedule for `.bankDown` resolves. Three
    /// attempts, then the auto-retry stops and the user is left with
    /// the manual "Retry now" CTA. Back-loaded so the first re-try
    /// fires fast (catches transient blips) but the schedule backs
    /// off if the provider stays down.
    public static let defaultSchedule: [TimeInterval] = [3, 8, 20]

    /// Iter-3 ADV5-IT2-002: hard cap on how long any single retry can
    /// sleep regardless of the server-supplied `Retry-After` hint.
    /// 60s is generous enough to honour realistic provider cooldowns
    /// while keeping the "3 attempts over ~30s" contract from being
    /// stretched by a misbehaving upstream into hours.
    public static let defaultMaxRetryAfter: TimeInterval = 60

    /// Exposed read-only for the owning service so it can express
    /// "has the retrier hit its cap?" without poking private state.
    public private(set) var schedule: [TimeInterval]
    public private(set) var attempt: Int = 0

    private let maxRetryAfter: TimeInterval
    private var currentKey: RetryKey?
    private var currentTask: Task<Void, Never>?
    private var paused: Bool = false

    public init(
        schedule: [TimeInterval] = BoundedRetrier.defaultSchedule,
        maxRetryAfter: TimeInterval = BoundedRetrier.defaultMaxRetryAfter
    ) {
        // ADV5-IT2-007: an empty schedule silently disables auto-retry.
        // The Add Recipient flow's "we'll try again automatically"
        // promise hinges on this firing; a quiet no-op is the worst
        // possible failure mode. Crash early at construction so the
        // misuse surfaces at sim startup, not three states deep into
        // a money flow.
        precondition(!schedule.isEmpty, "BoundedRetrier requires a non-empty retry schedule")
        self.schedule = schedule
        self.maxRetryAfter = maxRetryAfter
    }

    /// True when there is at least one schedule slot left for the
    /// current key. False when paused, when the cap has been hit, or
    /// when no work has been scheduled yet.
    public var canRetry: Bool {
        guard !paused else { return false }
        return attempt < schedule.count
    }

    /// Iter-3 ADV5-IT2-001: cap-exhaustion check that's independent
    /// of the `paused` flag. The owning service uses this to decide
    /// "are we out of retry budget?" without having a transient
    /// background pause poison the answer.
    public var isAtCap: Bool {
        attempt >= schedule.count
    }

    /// Schedule the next retry for `key`. If `key` differs from the
    /// currently-bound key, the attempt counter resets to 0
    /// automatically — that's the structural binding from OO-106.
    /// `initialDelay`, when non-nil, overrides the schedule slot for
    /// the FIRST retry only (used for HTTP 429 `Retry-After` hints).
    /// Subsequent retries always fall through to the next schedule
    /// slot.
    ///
    /// Iter-3 ADV5-IT2-002: `initialDelay` is clamped to
    /// `[0, maxRetryAfter]`. A negative server hint cannot fire
    /// immediately and hammer the backend; a 24-hour hint cannot
    /// hold the retrier hostage past the bounded total time budget.
    ///
    /// No-op when paused or when the cap has been reached for the
    /// current key.
    public func scheduleNext(
        forKey key: RetryKey,
        initialDelay: TimeInterval? = nil,
        action: @escaping @Sendable () async -> Void
    ) {
        currentTask?.cancel()
        if currentKey != key {
            currentKey = key
            attempt = 0
        }
        // First retry honours the server hint (429 Retry-After) when
        // present; later retries use the next schedule slot.
        let clampedHint = (attempt == 0)
            ? initialDelay.map { clampRetryAfter($0) }
            : nil
        scheduleNextInternal(forKey: key, useHint: clampedHint, action: action)
    }

    /// Cancel any pending timer AND clear the pause flag. Counter and
    /// key are preserved so a subsequent `resume(forKey:action:)` /
    /// `unpause()` picks up where we left off — backgrounding the app
    /// must not burn through the retry budget.
    public func pause() {
        paused = true
        currentTask?.cancel()
        currentTask = nil
    }

    /// Iter-3 OO-201 split: clear the pause flag and re-arm the timer
    /// against the bound key. Precondition: a key is bound AND the
    /// cap hasn't been hit. The previous combined API silently
    /// discarded `action` in those degenerate paths; now the failure
    /// mode is "no-op" without lying about which mode you wanted.
    public func resume(action: @escaping @Sendable () async -> Void) {
        paused = false
        guard let key = currentKey, attempt < schedule.count else { return }
        // Re-arm using the next schedule slot. We deliberately don't
        // honour any prior `initialDelay` hint — that hint was tied
        // to a specific 429 response that's now arbitrarily old.
        scheduleNextInternal(forKey: key, useHint: nil, action: action)
    }

    /// Iter-3 OO-201 split: clear the pause flag WITHOUT re-arming.
    /// Use when the lifecycle says "we're foreground again" but the
    /// current work-item is not eligible for a fresh retry (e.g. the
    /// state is `.resolved` / `.notFound` / `.sessionExpired`). No
    /// sentinel-closure ceremony at the call site.
    public func unpause() {
        paused = false
    }

    /// Reset the attempt counter to 0 without changing the bound key.
    /// Used by manual retries (`retryNow()` on the service): the user
    /// explicitly intervened, so they get a fresh retry budget.
    public func resetAttemptCounter() {
        attempt = 0
    }

    /// Iter-3 ADV5-IT2-004: cancels the pending timer AND drops the
    /// work-item state (key, counter, in-flight task). The `paused`
    /// flag is INTENTIONALLY preserved — that flag belongs to the
    /// scenePhase lifecycle, not to the current work item. A
    /// cancelAll triggered by "input changed" must not silently
    /// un-pause a backgrounded retrier.
    public func cancelAll() {
        currentTask?.cancel()
        currentTask = nil
        currentKey = nil
        attempt = 0
        // paused is NOT reset here. Lifecycle owns it.
    }

    /// True when the retrier is currently bound to `key`. Lets the
    /// owning service decide whether a "cap reached" condition
    /// applies to the current work item or to leftover state from a
    /// prior, now-cancelled cycle.
    public func isBound(toKey key: RetryKey) -> Bool {
        currentKey == key
    }

    // MARK: - Internals

    /// Iter-3 OO-204: single Task-building site shared by
    /// `scheduleNext` and `resume`. The hint-vs-no-hint branch lives
    /// here, so callers say their intent at the public surface (first
    /// retry vs resume) without re-implementing the Task plumbing.
    ///
    /// Iter-3 ADV5-IT2-010: attempt counter is incremented AFTER the
    /// sleep but BEFORE the action runs. Cancellation during sleep
    /// does NOT burn a slot. The action runs against the post-
    /// increment attempt, so any scheduleNext-from-action correctly
    /// reads the NEXT slot.
    private func scheduleNextInternal(
        forKey key: RetryKey,
        useHint: TimeInterval?,
        action: @escaping @Sendable () async -> Void
    ) {
        currentTask?.cancel()
        guard !paused else { return }
        guard attempt < schedule.count else { return }
        let delay = useHint ?? schedule[attempt]
        currentTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard let self, !Task.isCancelled, !self.paused else { return }
            // Commit the slot now that we've decided to fire. A
            // cancellation mid-sleep returns above and leaves the
            // counter untouched; once we're past the guards, the
            // attempt is spent regardless of what `action()` does.
            self.attempt += 1
            await action()
        }
    }

    /// Clamp an externally-supplied retry-after to the retrier's own
    /// time budget. Negative values fold to zero; huge values fold to
    /// `maxRetryAfter`. The retrier owns its time budget; external
    /// hints are advisory.
    private func clampRetryAfter(_ value: TimeInterval) -> TimeInterval {
        min(max(value, 0), maxRetryAfter)
    }
}
