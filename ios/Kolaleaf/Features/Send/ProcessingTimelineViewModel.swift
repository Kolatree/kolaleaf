// ProcessingTimelineViewModel.swift  (Phase 6 · U49)
// Polls `GET /api/v1/transfers/:id` every 5 seconds and pushes the
// freshest status into AppState. Stops on terminal states.
//
// State-only-advances invariant: a poll returning an earlier status
// than the current one is ignored. APNS state pushes in production
// can arrive out-of-order; the polling fallback must not regress the
// UI when that happens.
//
// TODO Phase 7: replace polling with APNS push when the
// `/account/push-tokens` flow is wired into the transfer-state
// notifications topic. Polling is the safety net regardless.

import Foundation
import Observation

@MainActor
@Observable
public final class ProcessingTimelineViewModel {

    private let api: AuthAPI
    private weak var appState: AppState?
    /// Iter-2 C1 / ADV-P7-C1: exposed so the parent view can wire the
    /// terminal-status callback back to the SendCoordinator.
    public let transferId: String
    private let pollInterval: TimeInterval

    public private(set) var currentStatus: TransferStatus
    public private(set) var isPolling: Bool = false
    public private(set) var lastError: String?

    /// ADV-P10B-C6: counts back-to-back failed polls so the loop can
    /// (a) back off to longer intervals and (b) eventually stop and
    /// surface a recoverable error rather than poll forever and drain
    /// battery. Reset to 0 on any successful poll.
    public private(set) var consecutiveErrors: Int = 0

    private var pollTask: Task<Void, Never>?

    public init(
        api: AuthAPI,
        transferId: String,
        initialStatus: TransferStatus,
        appState: AppState? = nil,
        pollInterval: TimeInterval = 5
    ) {
        self.api = api
        self.transferId = transferId
        self.currentStatus = initialStatus
        self.appState = appState
        self.pollInterval = pollInterval
    }

    /// Begin the polling loop. Idempotent — restart is a no-op while
    /// already running.
    ///
    /// Error-budget policy (ADV-P10B-C6): consecutive failures ramp the
    /// inter-poll sleep via the `errorBackoffSeconds` ladder so a sustained
    /// backend outage doesn't burn battery at the 5s base cadence. After
    /// `maxConsecutiveErrors` failures in a row, the loop stops and surfaces
    /// `lastError` for the user to manually retry (re-mount or pull-to-refresh
    /// re-creates the VM, resetting the counter). A successful poll resets the
    /// counter so a single recovered call returns the cadence to base.
    public func startPolling() {
        guard pollTask == nil else { return }
        isPolling = true
        pollTask = Task { @MainActor [weak self] in
            guard let self else { return }
            // Immediate fetch so the user doesn't wait `pollInterval`
            // for the first refresh.
            await self.pollOnce()
            while !Task.isCancelled {
                if TransferTimeline.isTerminal(self.currentStatus) {
                    break
                }
                if self.consecutiveErrors >= Self.maxConsecutiveErrors {
                    self.lastError = "Couldn't refresh — please pull to retry."
                    break
                }
                let delay = self.nextPollDelay()
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                if Task.isCancelled { break }
                await self.pollOnce()
            }
            self.isPolling = false
        }
    }

    /// Cap on consecutive failures before the loop stops. ~100 errors
    /// at the late-stage 60s cadence ≈ 100 minutes of dead-air; well
    /// past any plausible backend hiccup.
    private static let maxConsecutiveErrors = 100

    /// Backoff ladder applied AFTER each consecutive failure. Index is
    /// `min(consecutiveErrors - 1, count - 1)` so the first failure
    /// uses the base interval, subsequent failures climb. Caps at 300s.
    private static let errorBackoffSeconds: [TimeInterval] = [5, 5, 5, 10, 30, 60, 300]

    private func nextPollDelay() -> TimeInterval {
        guard consecutiveErrors > 0 else { return pollInterval }
        let i = min(consecutiveErrors - 1, Self.errorBackoffSeconds.count - 1)
        return Self.errorBackoffSeconds[i]
    }

    public func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
        isPolling = false
    }

    /// One-shot poll. Exposed so tests can drive the state-only-
    /// advances invariant without standing up the timer loop.
    public func pollOnce() async {
        // U76b4 + CA-2004: background poll — `.system` origin
        // (passed at the call site, Phase 10C iter-1) so this
        // success does not reset the user-touch idle clock.
        let result = await api.send(TransfersEndpoints.Get(id: transferId), origin: .system)
        switch result {
        case .success(let envelope):
            apply(envelope.transfer)
            consecutiveErrors = 0
            lastError = nil
        case .failure(let err):
            lastError = err.errorDescription
            consecutiveErrors += 1
        }
    }

    /// Apply an out-of-band update (e.g. APNS push) using the same
    /// state-only-advances rules. Split (W4 / OO-005) into a pure
    /// `applyPure(_:) -> Bool` (transition logic, returns whether the
    /// caller should also mirror) and `mirrorToAppState(_:)` so the
    /// transition decision can be unit-tested without touching
    /// AppState.
    public func apply(_ transfer: TransferShape) {
        let advanced = applyPure(transfer)
        if advanced { mirrorToAppState(transfer) }
    }

    /// Pure transition step. Returns `true` if `currentStatus`
    /// changed; `false` if the update was a no-change or regression.
    @discardableResult
    public func applyPure(_ transfer: TransferShape) -> Bool {
        let verdict = TransferTimeline.verdict(from: currentStatus, to: transfer.status)
        switch verdict {
        case .advance, .sadPathEscape:
            currentStatus = transfer.status
            return true
        case .noChange, .regression:
            return false
        }
    }

    /// Side-effecting mirror onto AppState. Kept separate from the
    /// transition logic for testability.
    public func mirrorToAppState(_ transfer: TransferShape) {
        let existing = appState?.activeTransfer
        appState?.activeTransfer = ActiveTransfer(
            id: transfer.id,
            status: transfer.status,
            audAmount: Decimal(string: transfer.sendAmount)
                ?? existing?.audAmount
                ?? 0,
            ngnAmount: transfer.receiveAmount.flatMap { Decimal(string: $0) }
                ?? existing?.ngnAmount
                ?? 0,
            recipientId: transfer.recipientId,
            // CA-902 / ADV-P9-W2: mirror the locked rate so the
            // expired-screen renders the correct value without
            // calling out to deriveRate (which has been removed).
            exchangeRate: Decimal(string: transfer.exchangeRate)
                ?? existing?.exchangeRate
                ?? 0
        )
    }

    // No deinit cancel: pollTask is MainActor-isolated and Swift's
    // strict-concurrency mode forbids reading it from a nonisolated
    // deinit. Callers invoke `stopPolling()` from `.onDisappear`
    // (see `ProcessingTimelineView`), so the live tree always cleans
    // up; a dropped reference will still cancel the task on the next
    // `try? await Task.sleep` iteration because the strong `self`
    // capture goes away.
}
