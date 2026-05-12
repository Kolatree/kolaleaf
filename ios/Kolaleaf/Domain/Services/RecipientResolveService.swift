// RecipientResolveService.swift  (Phase 4 · U37 / Phase 5 · U40 — iteration 3)
// Debounced bank-account-name lookup. The Add Recipient form re-calls
// `resolve(_:_:)` every time the bank or account number changes; this
// service collapses fast typing into a single API call and exposes
// the result as a `@Observable` `state` property the View binds to.
//
// Iteration 2 fixes (ADV5-001, ADV5-002, OO-101, OO-105, OO-106, OO-107, API-003).
//
// Iteration 3 fixes:
//   • API-202 — `ResolveState` case labels drop the `for` preposition.
//     The new shape reads naturally at every pattern-match site:
//     `case let .resolved(name, bankCode, accountNumber)`. The old
//     `forBankCode:` / `forAccountNumber:` labels added ceremony
//     without disambiguating anything.
//   • API-204 — `onSessionExpired` is a non-defaulted init parameter.
//     The previous public mutable property was effectively immutable
//     after the VM wired it once; the type system now matches
//     reality. Tests that don't care about the callback pass `{}`.
//   • OO-205 — `runResolve` is now `async`-returning instead of
//     producing a `Task<Void, Never>`. The auto-retry closure that
//     awaited `.value` no longer has to thread a Task through; it
//     just awaits the call.
//   • OO-201 / ADV5-IT2-003 — `resumeAutoRetry()` distinguishes
//     "re-arm the timer because the state is `.bankDown`" from
//     "the state is anything else, just clear the pause flag". Splits
//     onto the BoundedRetrier's `resume(action:)` / `unpause()`
//     surface; no sentinel-closure ceremony.
//   • ADV5-IT2-001 — exhaustion check uses `retrier.isAtCap` instead
//     of `!retrier.canRetry`. A backgrounded pause-mid-flight no
//     longer makes the service believe the retry budget is spent.
//   • ADV5-IT2-009 — manual retry taps debounced to 1Hz. Spamming
//     "Retry now" during a partial outage no longer racks up
//     upstream calls; the second tap within 1s is silently dropped.
//
// Threading / concurrency:
//   • `@MainActor`-isolated. SwiftUI's Observation framework requires
//     the published property to be touched on the same actor as the
//     observer (the View body runs on MainActor).
//   • In-flight task is cancelled pre-emptively on every new resolve
//     call AND inside `runResolve` itself.
//   • Auto-retry timer lives on `BoundedRetrier`.

import Foundation
import Observation

/// What the View renders. Each non-`.idle` case carries the
/// (bankCode, accountNumber) pair that produced it so the calling VM
/// can ASSERT, at save-time, that the user did not change the input
/// after the resolve completed.
///
/// Iter-3 (API-202): the case labels are bare nouns. Patterns read
/// `case let .resolved(name, bankCode, accountNumber)` — the labels
/// describe what each value IS, not its prepositional relationship.
public enum ResolveState: Sendable, Equatable {
    case idle
    case resolving(bankCode: String, accountNumber: String)
    case resolved(name: String, bankCode: String, accountNumber: String)
    case notFound(bankCode: String, accountNumber: String)
    /// Underlying provider was unreachable (5xx, transport, rate-limit).
    /// `retryAfter` carries the rate-limit hint when present so the
    /// auto-retry can honour the server-side cooldown.
    /// API-005: the hint lives ONLY on this case because it's only
    /// meaningful while the auto-retry is still scheduling further
    /// attempts; once we transition to `.bankDownExhausted` the
    /// timer is dead and the hint has no consumer.
    case bankDown(bankCode: String, accountNumber: String, retryAfter: TimeInterval?)
    /// ADV5-002: terminal "we ran out of automatic retries" state.
    /// The View renders the same amber chrome as `.bankDown` but
    /// drops the "we'll try again automatically" copy in favour of
    /// a prominent "Tap Retry now" instruction. Without this case
    /// the user sees the in-progress message forever after the 3rd
    /// auto-retry fails.
    case bankDownExhausted(bankCode: String, accountNumber: String)
    /// HTTP 401 — session expired. Distinct from `.bankDown` because
    /// the user-visible remedy is "sign in again", not "wait + retry".
    case sessionExpired
}

@MainActor
@Observable
public final class RecipientResolveService {

    public private(set) var state: ResolveState = .idle

    /// Time the service waits between the latest input and dispatching
    /// the API call. Short enough to feel instant when the user
    /// finishes typing, long enough to collapse the keystrokes that
    /// fill the trailing digits of a 10-digit NUBAN.
    public static let defaultDebounce: Duration = .milliseconds(300)

    /// Production retry schedule for `.bankDown`. Three attempts,
    /// then the auto-retry transitions to `.bankDownExhausted` and
    /// the user is left with the manual "Retry now" CTA.
    public static let defaultRetrySchedule: [TimeInterval] = BoundedRetrier.defaultSchedule

    /// Iter-3 ADV5-IT2-009: minimum gap between two manual
    /// `retryNow()` calls. Tap-spam during an outage no longer
    /// hammers the resolve endpoint.
    public static let defaultManualRetryMinInterval: TimeInterval = 1.0

    /// Backwards-compat alias retained so the original Phase 4 callers
    /// that read `RecipientResolveService.debounce` keep compiling.
    public static let debounce: Duration = defaultDebounce

    private let api: AuthAPI
    private let debounce: Duration
    private let retrier: BoundedRetrier
    private let onSessionExpired: @MainActor () -> Void
    private let manualRetryMinInterval: TimeInterval

    private var inflightTask: Task<Void, Never>?
    /// Iter-3 ADV5-IT2-009: timestamp of the last successful manual
    /// retry. Used to ignore tap-spam within `manualRetryMinInterval`.
    private var lastManualRetryAt: Date?

    /// Iter-3 (API-204): `onSessionExpired` is now an init parameter
    /// rather than a public mutable property. Construction sites are
    /// the only places that should wire it. Tests / previews pass
    /// `{}` when the callback is irrelevant.
    public init(
        api: AuthAPI,
        debounce: Duration = RecipientResolveService.defaultDebounce,
        retrySchedule: [TimeInterval] = RecipientResolveService.defaultRetrySchedule,
        manualRetryMinInterval: TimeInterval = RecipientResolveService.defaultManualRetryMinInterval,
        onSessionExpired: @escaping @MainActor () -> Void = { }
    ) {
        self.api = api
        self.debounce = debounce
        self.retrier = BoundedRetrier(schedule: retrySchedule)
        self.manualRetryMinInterval = manualRetryMinInterval
        self.onSessionExpired = onSessionExpired
    }

    /// Re-trigger the debounced resolve. Safe to call on every
    /// keystroke; the in-flight task is cancelled pre-emptively so
    /// only the latest input ever resolves.
    ///
    /// **Synchronous invariant:** before the debounce is enqueued,
    /// `state` is reset to `.idle`. This closes the 300 ms window
    /// where a stale `.resolved` value would survive a fresh
    /// keystroke and let the View's "Save" CTA stay enabled against
    /// outdated input.
    public func resolve(bankCode: String, accountNumber: String) async {
        // Cancel any prior debounce-in-progress (or in-flight call).
        inflightTask?.cancel()
        // Input changed — any pending auto-retry was bound to the
        // PRIOR (bankCode, accountNumber) and must be dropped.
        retrier.cancelAll()
        // Synchronously drop to idle so a stale `.resolved` cannot
        // outlive the input change (ADV-001 fix).
        state = .idle

        guard NubanRules.isValid(bankCode: bankCode, accountNumber: accountNumber) else {
            inflightTask = nil
            return
        }

        // Spawn an unstructured task so `resolve` returns immediately
        // (the View calls this from a setter and shouldn't block on
        // the full network round-trip). The task is stored so a
        // subsequent `resolve` can cancel it pre-emptively.
        let task: Task<Void, Never> = Task { @MainActor [weak self] in
            await self?.runResolve(bankCode: bankCode, accountNumber: accountNumber)
        }
        inflightTask = task
    }

    /// Manual retry — fired by the bankDown / bankDownExhausted
    /// card's "Retry now" CTA. Resets the attempt counter (the user
    /// explicitly intervened, so they get a fresh retry budget) and
    /// re-fires resolve against the (bankCode, accountNumber)
    /// embedded in the current state. No-op outside `.bankDown` or
    /// `.bankDownExhausted` since there is nothing to retry.
    ///
    /// OO-107: this differs from `resumeAutoRetry()` — that method
    /// does NOT reset the counter because foreground-after-background
    /// is not user intervention.
    ///
    /// Iter-3 ADV5-IT2-009: rapid double-taps are debounced. The
    /// second tap within `manualRetryMinInterval` is silently dropped
    /// so a panicking user can't rack up upstream calls during an
    /// outage.
    public func retryNow() async {
        let target: (String, String)?
        switch state {
        case let .bankDown(bankCode, accountNumber, _):
            target = (bankCode, accountNumber)
        case let .bankDownExhausted(bankCode, accountNumber):
            // ADV5-002: manual retry from the exhausted state must
            // succeed — the user is explicitly asking for another
            // round, even though auto-retry stopped trying.
            target = (bankCode, accountNumber)
        default:
            target = nil
        }
        guard let (bankCode, accountNumber) = target else { return }

        // ADV5-IT2-009: debounce rapid taps.
        let now = Date()
        if let last = lastManualRetryAt,
           now.timeIntervalSince(last) < manualRetryMinInterval {
            return
        }
        lastManualRetryAt = now

        retrier.cancelAll()
        await runResolve(bankCode: bankCode, accountNumber: accountNumber)
    }

    /// Stop firing auto-retries. Called from the View when the app
    /// backgrounds (`scenePhase == .background`). The current `state`
    /// is preserved so foregrounding can resume from where we left off.
    /// API-002: paired with `resumeAutoRetry()` — the asymmetry is
    /// intentional. Pause must be cheap and idempotent because
    /// scenePhase fires on every transition; resume re-arms the
    /// timer using the bound key from the prior pause.
    public func pauseAutoRetry() {
        retrier.pause()
    }

    /// Re-arm auto-retry. Called from the View when the app returns
    /// to the foreground. If the current `state` is `.bankDown`, the
    /// retrier resumes from the next schedule slot; otherwise the
    /// pause flag is simply cleared (nothing to re-arm).
    ///
    /// OO-107: does NOT reset the attempt counter. The user did not
    /// intervene; the app simply came back from background. We pick
    /// up where we left off rather than burning a fresh budget.
    ///
    /// Iter-3 (OO-201 / ADV5-IT2-003): non-`.bankDown` states route
    /// to `retrier.unpause()` instead of `retrier.resume(action: {})`.
    /// The previous sentinel-closure was a tell that the API was
    /// wrong; the new split lets the call site say its intent.
    public func resumeAutoRetry() {
        guard case let .bankDown(bankCode, accountNumber, _) = state else {
            // Either still resolving, already resolved, exhausted, or
            // session expired — nothing to resume.
            retrier.unpause()
            return
        }
        retrier.resume { [weak self] in
            await self?.runResolve(bankCode: bankCode, accountNumber: accountNumber)
        }
    }

    /// Cancel any in-flight resolve, drop all auto-retry state, and
    /// return to `.idle`. Use when the View dismisses the Add
    /// Recipient sheet so a stale resolve can't leak into the next
    /// presentation.
    /// API-003: renamed from `reset()` to spell out the full effect
    /// (cancels in-flight + cancels auto-retry + zeroes counter +
    /// sets state to `.idle`).
    public func cancelAndReset() {
        inflightTask?.cancel()
        inflightTask = nil
        retrier.cancelAll()
        state = .idle
    }

    // MARK: - Internals

    /// Dispatch the debounced resolve. Shared between the public
    /// `resolve(_:_:)` entry point, the auto-retry timer, and the
    /// manual retry path so all three apply the same debounce +
    /// cancellation discipline.
    ///
    /// ADV5-001: cancels `inflightTask` at the very top so a manual
    /// retry firing concurrently with an auto-retry wakeup can never
    /// spawn two billed `/resolve` calls. The freshly-spawned inner
    /// Task is stored as `inflightTask` so the NEXT call's cancel
    /// step lands on it.
    ///
    /// Iter-3 (OO-205): returns `Void` (`async`) rather than
    /// `Task<Void, Never>`. The internal Task ownership is preserved
    /// — we still create one and assign it to `inflightTask` for
    /// cross-path cancellation — but callers no longer have to
    /// thread a Task value through `.value` ceremony; they just
    /// `await` the call.
    private func runResolve(bankCode: String, accountNumber: String) async {
        // ADV5-001 fix: cancel any existing in-flight task BEFORE
        // overwriting the slot. Without this, the auto-retry's wake
        // and a user's manual "Retry now" can race, producing two
        // concurrent billed `/resolve` calls.
        inflightTask?.cancel()

        let task: Task<Void, Never> = Task { @MainActor [api, debounce] in
            // Debounce. If the user keeps typing, this whole task is
            // cancelled before the sleep returns and we never call
            // the API.
            try? await Task.sleep(for: debounce)
            guard !Task.isCancelled else { return }

            self.state = .resolving(
                bankCode: bankCode,
                accountNumber: accountNumber
            )

            let result = await api.send(
                RecipientsEndpoints.Resolve(
                    bankCode: bankCode,
                    accountNumber: accountNumber
                )
            )
            // A late-cancelled task (the user typed again while the
            // network was outstanding) must NOT clobber the next
            // task's state.
            guard !Task.isCancelled else { return }

            switch result {
            case .success(let response):
                self.state = .resolved(
                    name: response.accountName,
                    bankCode: bankCode,
                    accountNumber: accountNumber
                )
                // Successful resolution clears any auto-retry plumbing.
                self.retrier.cancelAll()
            case .failure(let error):
                let next = ResolveErrorMapper.map(
                    error,
                    bankCode: bankCode,
                    accountNumber: accountNumber
                )
                self.state = next
                // Only `.bankDown` triggers auto-retry. `.notFound`
                // and `.sessionExpired` are terminal user-facing
                // states with their own remedies.
                if case let .bankDown(_, _, retryAfter) = next {
                    self.scheduleAutoRetry(
                        bankCode: bankCode,
                        accountNumber: accountNumber,
                        retryAfter: retryAfter
                    )
                } else {
                    self.retrier.cancelAll()
                    // ADV5-008: surface the session-expired
                    // transition so the VM can route to re-auth
                    // even when the resolve fired from a
                    // backgrounded auto-retry the user is not
                    // watching.
                    if case .sessionExpired = next {
                        self.onSessionExpired()
                    }
                }
            }
        }
        inflightTask = task
        // Await completion so callers can serialise on the round-trip
        // when they need to (manual retry path; auto-retry closure).
        // The public `resolve(_:_:)` wraps the whole runResolve in its
        // own outer Task so it returns immediately without blocking
        // the SwiftUI setter that triggered it.
        await task.value
    }

    /// Schedule the next auto-retry through the `BoundedRetrier`. If
    /// the retrier has hit its hard cap, transition the state to
    /// `.bankDownExhausted` (ADV5-002) so the View stops promising
    /// further automatic attempts.
    ///
    /// Iter-3 ADV5-IT2-001: exhaustion uses `retrier.isAtCap` instead
    /// of `!retrier.canRetry`. The previous check folded "paused"
    /// into "exhausted", so a backgrounded auto-retry that finished
    /// in-flight after pause was silently treated as out-of-budget.
    private func scheduleAutoRetry(
        bankCode: String,
        accountNumber: String,
        retryAfter: TimeInterval?
    ) {
        let key = RetryKey(bankCode: bankCode, accountNumber: accountNumber)
        // If the retrier is already bound to this key and has hit the
        // cap, this would be the 4th+ auto-retry — promote to
        // exhausted instead of silently dropping the schedule.
        // `isAtCap` is paused-independent, so an overlapping
        // background pause does not poison the exhaustion check.
        if retrier.isBound(toKey: key), retrier.isAtCap {
            state = .bankDownExhausted(
                bankCode: bankCode,
                accountNumber: accountNumber
            )
            retrier.cancelAll()
            return
        }

        retrier.scheduleNext(forKey: key, initialDelay: retryAfter) { [weak self] in
            await self?.runResolve(bankCode: bankCode, accountNumber: accountNumber)
        }
    }
}
