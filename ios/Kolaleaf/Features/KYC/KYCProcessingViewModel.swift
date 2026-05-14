// KYCProcessingViewModel.swift  (Phase 2 · U25)
// Drives screen 07: orbit spinner + 3-step list while polling
// `GET /api/v1/kyc/status` every 3 s. Resolves to one of four terminal
// states (verified, rejected, timedOut, unauthorized) and lets the parent
// coordinator route accordingly.
//
// Lifecycle:
//   • View calls `start()` on first appear. `pause()` suspends without
//     losing the elapsed-time counter; `resume()` resumes from where pause
//     left off. View binds these to scenePhase so polling stops when
//     backgrounded.
//   • `stop()` cancels and clears state — used on view disappear.
//   • Hard timeout at 10 minutes (configurable per instance for tests).
//   • Server `Retry-After` is honored (Phase 2 review fix · reliability rel-3).

import Foundation
import Observation

@MainActor
@Observable
public final class KYCProcessingViewModel {

    public enum Terminal: Equatable, Sendable {
        case verified
        case rejected
        /// Polling has been running for the full timeout without resolution.
        case timedOut
        /// Phase 2 review fix (P1, correctness CR-6 / reliability rel-4 /
        /// maintainability M3): 401 used to fold into `.timedOut`, which
        /// trapped the user on the under-review screen with no recovery.
        /// The coordinator now drives a force-reauth on this case.
        case unauthorized
    }

    public private(set) var pollAttempts: Int = 0
    public private(set) var lastError: String?
    public private(set) var observedStatus: KycStatus = .unknown
    public private(set) var terminal: Terminal?
    public private(set) var consecutiveFailures: Int = 0

    /// Public for tests so they can compress the polling clock.
    public var pollIntervalSeconds: Double = 3.0
    public var timeoutSeconds: Double = 600.0  // 10 min

    private let api: AuthAPI
    private var task: Task<Void, Never>?
    /// Total elapsed polling time across pause/resume cycles. We track
    /// elapsed seconds rather than a wall-clock start so background time
    /// (paused) doesn't count against the 10-min budget (reliability rel-1).
    private var elapsedSeconds: Double = 0
    /// Wall-clock when the loop last entered an active tick. Nil while paused
    /// or stopped.
    private var resumedAt: Date?
    /// When `Retry-After` arrives, the next sleep honors `max(retryAfter,
    /// pollIntervalSeconds)`. Cleared after one consumption.
    private var nextDelayOverrideSeconds: Double?

    public init(api: AuthAPI) {
        self.api = api
    }

    // MARK: - Lifecycle

    /// Starts polling from a clean slate. Idempotent.
    public func start() {
        task?.cancel()
        elapsedSeconds = 0
        resumedAt = Date()
        task = Task { @MainActor [weak self] in
            await self?.pollLoop()
        }
    }

    /// Suspends polling without resetting elapsed time. The View calls this
    /// on `scenePhase == .background` so iOS doesn't keep hitting the
    /// backend while the user is away.
    public func pause() {
        guard task != nil else { return }
        task?.cancel()
        task = nil
        // Roll the active interval into elapsedSeconds so resume picks up
        // exactly where pause left off.
        if let resumed = resumedAt {
            elapsedSeconds += Date().timeIntervalSince(resumed)
            resumedAt = nil
        }
    }

    /// Resumes a paused loop. No-op if the loop is already running or has
    /// resolved a terminal state.
    public func resume() {
        guard task == nil, terminal == nil else { return }
        resumedAt = Date()
        task = Task { @MainActor [weak self] in
            await self?.pollLoop()
        }
    }

    /// Cancels polling without resolving a terminal state.
    public func stop() {
        task?.cancel()
        task = nil
        resumedAt = nil
    }

    // MARK: - Polling loop

    private func pollLoop() async {
        while !Task.isCancelled {
            if currentElapsedSeconds() >= timeoutSeconds {
                terminal = .timedOut
                return
            }

            await pollOnce()
            if terminal != nil { return }

            // Honor server-supplied Retry-After when present, otherwise the
            // configured interval. Phase 2 review fix · reliability rel-3.
            let delay = nextDelayOverrideSeconds.map { max($0, pollIntervalSeconds) }
                ?? pollIntervalSeconds
            nextDelayOverrideSeconds = nil

            let nanos = UInt64(max(0.1, delay) * 1_000_000_000)
            try? await Task.sleep(nanoseconds: nanos)
        }
    }

    private func currentElapsedSeconds() -> Double {
        let activeWindow = resumedAt.map { Date().timeIntervalSince($0) } ?? 0
        return elapsedSeconds + activeWindow
    }

    private func pollOnce() async {
        pollAttempts += 1
        let result = await api.send(KYCEndpoints.Status())
        switch result {
        case .success(let response):
            consecutiveFailures = 0
            lastError = nil
            observedStatus = response.status
            switch response.status {
            case .verified:
                terminal = .verified
            case .rejected:
                terminal = .rejected
            case .inReview, .pending, .unknown:
                break
            }
        case .failure(let error):
            consecutiveFailures += 1
            lastError = userFacingMessage(for: error)
            switch error {
            case .unauthorized:
                terminal = .unauthorized
            case .rateLimited(let retryAfter):
                // Defer the next sleep to honor Retry-After; loop continues.
                nextDelayOverrideSeconds = retryAfter
            default:
                break
            }
        }
    }

    private func userFacingMessage(for error: APIError) -> String {
        switch error {
        case .transport:
            return String(
                localized: "kyc.processing.reconnecting",
                defaultValue: "Reconnecting…"
            )
        case .unauthorized:
            return String(
                localized: "common.error.session_expired",
                defaultValue: "Your session expired. Please sign in again."
            )
        case .rateLimited(let after):
            return String(
                localized: "kyc.processing.rate_limited",
                defaultValue: "Too many requests. Pausing for \(Int(after))s."
            )
        default:
            return error.errorDescription ?? String(
                localized: "kyc.processing.unreachable",
                defaultValue: "Couldn't reach Kolaleaf."
            )
        }
    }
}
