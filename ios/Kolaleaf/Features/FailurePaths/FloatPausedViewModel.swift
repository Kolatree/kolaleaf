// FloatPausedViewModel.swift  (Phase 9 · U64 + iter-3 F2/F3/F9/F10)
// Drives Screen 41: the transfer briefly holds in FLOAT_INSUFFICIENT
// while treasury tops the NGN rail. The VM polls for a status change
// and runs an ETA countdown alongside.
//
// PRIVACY INVARIANT (do not regress):
//   This VM never speaks the treasury reason. Copy is operational —
//   "we're holding briefly", "we'll text you when it's moving" — and
//   forbidden words ("float", "treasury", "liquidity", "insufficient",
//   "balance") never appear in user-visible state.
//
// iter-3 changes:
//   • F9 / API-906: 240s magic constant lifted to
//     `defaultRailResumeETASeconds`; both default-arg sites use it.
//   • F2 / ADV-P9-C4 + ADV-P9-W4: every poll cycle captures a
//     generation token. A `stop()`-then-`start()` dance bumps the
//     token so any in-flight poll returning AFTER the bump exits
//     silently — no state mutation, no `onResume` fire. Prevents the
//     classic "VM resumed twice / fired callback after stop()" race.
//   • F3 / ADV-P9-W7: countdown is anchored to a wall-clock
//     `deadline: Date` set at init. `tick()` and `resync()` recompute
//     `remainingSeconds` from `deadline.timeIntervalSinceNow` so a
//     backgrounded app re-foregrounding correctly re-syncs (the user
//     comes back to a smaller number, not a paused-at-the-old-value
//     number). View calls `resync()` on `.onChange(of: scenePhase)`.
//   • F10 / API-907: `currentStatus` / `hasResumed` / `lastError`
//     collapsed into a single `state: FloatPausedState` so the View
//     switches once instead of `if`-checking each flag.
//
// Polling pattern mirrors `ProcessingTimelineViewModel`:
//   • 5s default cadence.
//   • Idempotent start; explicit stop required (View calls
//     `.onDisappear`).
//   • State-only-advances: a poll returning `.floatInsufficient`
//     keeps the VM in place; any other status fires `onResume`
//     exactly once and stops the loop.

import Foundation
import Observation

/// Single source of truth for the float-paused screen.
///
/// `holding` carries the live `remainingSeconds` so the View renders
/// from one value rather than juggling a flag + a counter. `resumed`
/// carries the new `TransferStatus` so a parent that needs to route
/// (handleTerminal) sees what the poll observed. `error` carries a
/// user-displayable message but is non-terminal — a subsequent poll
/// may transition the VM out of the error band.
public enum FloatPausedState: Equatable, Sendable {
    case holding(remainingSeconds: Int)
    case resuming
    case resumed(TransferStatus)
    case error(String)
}

@MainActor
@Observable
public final class FloatPausedViewModel {

    /// Ops SLA: 95th-percentile float top-up window.
    public static let defaultRailResumeETASeconds: TimeInterval = 240

    private let api: AuthAPI
    public let transferId: String
    private let pollInterval: TimeInterval
    private let onResume: ((TransferStatus) -> Void)?

    /// Wall-clock deadline. Subtracted from `Date()` on every tick /
    /// resync so the countdown stays accurate across scene-phase
    /// transitions (background → active doesn't lose seconds).
    private let deadline: Date

    public private(set) var state: FloatPausedState

    private var pollTask: Task<Void, Never>?
    private var didNotifyResume: Bool = false

    /// F2: every `start()` / `stop()` increments this. The polling
    /// task body and `apply(_:)` capture it on entry and re-check
    /// before mutating state — a stale poll returning after a stop
    /// (or restart) exits silently rather than racing the new VM
    /// generation.
    private var generation: UInt64 = 0

    public init(
        api: AuthAPI,
        transferId: String,
        etaSeconds: TimeInterval = FloatPausedViewModel.defaultRailResumeETASeconds,
        pollInterval: TimeInterval = 5,
        onResume: ((TransferStatus) -> Void)? = nil
    ) {
        self.api = api
        self.transferId = transferId
        self.pollInterval = pollInterval
        self.onResume = onResume
        self.deadline = Date().addingTimeInterval(max(0, etaSeconds))
        self.state = .holding(remainingSeconds: max(0, Int(etaSeconds)))
    }

    /// Test seam — lets a test backdate the deadline to verify
    /// `resync()` recomputes from the new wall-clock anchor without
    /// having to wait real seconds. Production callers use the
    /// `etaSeconds` initialiser.
    init(
        api: AuthAPI,
        transferId: String,
        deadlineOverride: Date,
        pollInterval: TimeInterval = 5,
        onResume: ((TransferStatus) -> Void)? = nil
    ) {
        self.api = api
        self.transferId = transferId
        self.pollInterval = pollInterval
        self.onResume = onResume
        self.deadline = deadlineOverride
        let secs = max(0, Int(deadlineOverride.timeIntervalSinceNow))
        self.state = .holding(remainingSeconds: secs)
    }

    // MARK: - Status accessors (used by the View / tests)

    /// Convenience: current observed status. Defaults to
    /// `.floatInsufficient` while the VM is holding so existing call
    /// sites that read `currentStatus` (tests + initial View render)
    /// keep compiling without re-shaping every assertion.
    public var currentStatus: TransferStatus {
        switch state {
        case .holding, .resuming:        return .floatInsufficient
        case .resumed(let status):       return status
        case .error:                     return .floatInsufficient
        }
    }

    /// Convenience: true once the VM has observed a non-paused status.
    public var hasResumed: Bool {
        if case .resumed = state { return true }
        return false
    }

    /// Convenience: the last user-displayable error message, or nil.
    public var lastError: String? {
        if case .error(let msg) = state { return msg }
        return nil
    }

    /// Convenience: live countdown value. Always read from `state`
    /// when holding; falls back to 0 once we've resumed.
    public var remainingSeconds: Int {
        if case .holding(let secs) = state { return secs }
        return 0
    }

    // MARK: - Countdown

    /// F3: recompute remaining seconds from the wall-clock deadline.
    /// Holds at 0 — the View flips to "Still holding…" when the ETA
    /// elapses; we never go negative.
    public func tick() {
        resync()
    }

    /// View calls this on `.onChange(of: scenePhase)` so a
    /// backgrounded app re-foregrounding doesn't see a stale paused
    /// counter. Safe to call any time — a no-op when the VM is past
    /// the holding state.
    public func resync() {
        guard case .holding = state else { return }
        let secs = max(0, Int(deadline.timeIntervalSinceNow))
        state = .holding(remainingSeconds: secs)
    }

    // MARK: - Polling

    /// Start the poll loop. Idempotent — restart while running is a no-op.
    public func start() {
        guard pollTask == nil else { return }
        generation &+= 1
        let myGen = generation
        pollTask = Task { @MainActor [weak self] in
            guard let self else { return }
            // Immediate fetch so the user doesn't wait `pollInterval`
            // for the first refresh.
            await self.pollOnce(generation: myGen)
            while !Task.isCancelled {
                if self.generation != myGen { return }
                if self.hasResumed { break }
                try? await Task.sleep(nanoseconds: UInt64(self.pollInterval * 1_000_000_000))
                if Task.isCancelled { return }
                if self.generation != myGen { return }
                await self.pollOnce(generation: myGen)
            }
        }
    }

    public func stop() {
        generation &+= 1
        pollTask?.cancel()
        pollTask = nil
    }

    /// One-shot poll. Public form (no generation arg) is used by tests
    /// to drive the resume invariant without spinning the timer loop;
    /// the loop calls the private generation-aware variant.
    public func pollOnce() async {
        await pollOnce(generation: generation)
    }

    private func pollOnce(generation expected: UInt64) async {
        // U76b4: background poll — `.system` origin so the success
        // does not reset the user-touch idle clock.
        let result = await api.send(TransfersEndpoints.GetForBackgroundPoll(id: transferId))
        // F2: bail if the VM has been stopped/restarted while the
        // request was in flight.
        guard generation == expected else { return }
        switch result {
        case .success(let envelope):
            apply(envelope.transfer, generation: expected)
        case .failure(let err):
            state = .error(err.errorDescription ?? "Couldn't refresh.")
        }
    }

    /// Apply a polled transfer. Status leaves `.floatInsufficient`
    /// → state moves to `.resumed` and `onResume` fires once.
    public func apply(_ transfer: TransferShape) {
        apply(transfer, generation: generation)
    }

    private func apply(_ transfer: TransferShape, generation expected: UInt64) {
        guard generation == expected else { return }
        guard transfer.status != .floatInsufficient else {
            // Stay holding; refresh the countdown so the on-screen
            // number stays current relative to the wall clock.
            resync()
            return
        }
        guard !didNotifyResume else { return }
        didNotifyResume = true
        state = .resumed(transfer.status)
        onResume?(transfer.status)
    }
}
