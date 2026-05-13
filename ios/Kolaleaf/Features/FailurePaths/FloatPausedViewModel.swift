// FloatPausedViewModel.swift  (Phase 9 · U64)
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
// Polling pattern mirrors `ProcessingTimelineViewModel`:
//   • 5s default cadence.
//   • Idempotent start; explicit stop required (View calls
//     `.onDisappear`).
//   • State-only-advances: a poll returning `.floatInsufficient`
//     keeps the VM in place; any other status fires `onResume`
//     exactly once and stops the loop.
// `tick()` advances the countdown by one second (caller drives it
// from a Timer publisher; tests call directly).

import Foundation
import Observation

@MainActor
@Observable
public final class FloatPausedViewModel {

    private let api: AuthAPI
    public let transferId: String
    private let pollInterval: TimeInterval
    private let onResume: ((TransferStatus) -> Void)?

    public private(set) var remainingSeconds: Int
    public private(set) var currentStatus: TransferStatus = .floatInsufficient
    public private(set) var hasResumed: Bool = false
    public private(set) var lastError: String?

    private var pollTask: Task<Void, Never>?
    private var didNotifyResume: Bool = false

    public init(
        api: AuthAPI,
        transferId: String,
        etaSeconds: TimeInterval = 240,
        pollInterval: TimeInterval = 5,
        onResume: ((TransferStatus) -> Void)? = nil
    ) {
        self.api = api
        self.transferId = transferId
        self.pollInterval = pollInterval
        self.remainingSeconds = max(0, Int(etaSeconds))
        self.onResume = onResume
    }

    /// Decrement the countdown by one second. Holds at 0 — we never
    /// flip to "overdue" copy when the ETA elapses; the View just
    /// stops the timer and shows "Still holding…".
    public func tick() {
        if remainingSeconds > 0 {
            remainingSeconds -= 1
        }
    }

    /// Start the poll loop. Idempotent — restart while running is a no-op.
    public func start() {
        guard pollTask == nil else { return }
        pollTask = Task { @MainActor [weak self] in
            guard let self else { return }
            // Immediate fetch so the user doesn't wait `pollInterval`
            // for the first refresh.
            await self.pollOnce()
            while !Task.isCancelled {
                if self.hasResumed { break }
                try? await Task.sleep(nanoseconds: UInt64(self.pollInterval * 1_000_000_000))
                if Task.isCancelled { break }
                await self.pollOnce()
            }
        }
    }

    public func stop() {
        pollTask?.cancel()
        pollTask = nil
    }

    /// One-shot poll. Exposed so tests can drive the resume invariant
    /// without spinning the timer loop.
    public func pollOnce() async {
        let result = await api.send(TransfersEndpoints.Get(id: transferId))
        switch result {
        case .success(let envelope):
            apply(envelope.transfer)
        case .failure(let err):
            lastError = err.errorDescription
        }
    }

    /// Apply a polled transfer. Status leaves `.floatInsufficient`
    /// → `hasResumed = true` and `onResume` fires once.
    public func apply(_ transfer: TransferShape) {
        currentStatus = transfer.status
        guard transfer.status != .floatInsufficient else { return }
        guard !didNotifyResume else { return }
        didNotifyResume = true
        hasResumed = true
        onResume?(transfer.status)
    }
}
