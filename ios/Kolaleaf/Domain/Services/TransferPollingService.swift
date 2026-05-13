// TransferPollingService.swift  (Phase 6 iter-2 · W7 / CA-003)
// Polling-loop concerns extracted from `ProcessingTimelineViewModel`.
// The view model now subscribes to a single `start(transferId:)`
// async stream and applies the resulting `TransferShape` values to
// its presentation state. The loop itself — interval, terminal-state
// stop, error capture — lives here.

import Foundation

/// Single yield from the polling stream. Either a fresh transfer
/// snapshot or an error captured during a poll attempt.
public enum TransferPollUpdate: Sendable {
    case snapshot(TransferShape)
    case error(APIError)
}

public protocol TransferPollingService: AnyObject, Sendable {
    /// Begin polling for `transferId`. The returned stream finishes
    /// when polling reaches a terminal state or `stop()` is invoked.
    func start(transferId: String) -> AsyncStream<TransferPollUpdate>
    /// Cancel the in-flight poll loop (if any).
    func stop()
}

/// Default `URLSession`-backed implementation.
@MainActor
public final class LiveTransferPollingService: TransferPollingService {
    private let api: AuthAPI
    private let pollInterval: TimeInterval
    private var pollTask: Task<Void, Never>?

    public init(api: AuthAPI, pollInterval: TimeInterval = 5) {
        self.api = api
        self.pollInterval = pollInterval
    }

    nonisolated public func start(transferId: String) -> AsyncStream<TransferPollUpdate> {
        AsyncStream { continuation in
            let task = Task { @MainActor in
                self.pollTask?.cancel()
                self.pollTask = Task { @MainActor [weak self] in
                    guard let self else { continuation.finish(); return }
                    var lastStatus: TransferStatus?
                    while !Task.isCancelled {
                        // U76b4: background poll — `.system` origin so success
                        // does not reset the user-touch idle clock.
                        let result = await self.api.send(TransfersEndpoints.GetForBackgroundPoll(id: transferId))
                        switch result {
                        case .success(let envelope):
                            continuation.yield(.snapshot(envelope.transfer))
                            lastStatus = envelope.transfer.status
                            if let s = lastStatus, TransferTimeline.isTerminal(s) {
                                continuation.finish()
                                return
                            }
                        case .failure(let err):
                            continuation.yield(.error(err))
                        }
                        if Task.isCancelled { break }
                        try? await Task.sleep(nanoseconds: UInt64(self.pollInterval * 1_000_000_000))
                    }
                    continuation.finish()
                }
            }
            continuation.onTermination = { _ in
                task.cancel()
                Task { @MainActor in
                    self.pollTask?.cancel()
                    self.pollTask = nil
                }
            }
        }
    }

    nonisolated public func stop() {
        Task { @MainActor in
            self.pollTask?.cancel()
            self.pollTask = nil
        }
    }
}
