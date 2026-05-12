// TransferAuditLogger.swift  (Phase 6 iter-2 · S7 / CA-009)
// Client-side audit hook for money-path actions. The backend's
// TransferEvent table is the source of truth for AUSTRAC reporting;
// this iOS-side logger captures device-local observability so we can
// debug "the user said they tapped slide but the server has no event"
// scenarios without relying on screen recordings.
//
// Default implementation is a no-op. Production wires a logger
// implementation that emits to the existing analytics pipe; tests
// can inject a fake to assert call sequences.

import Foundation

public enum TransferAuditAction: Sendable, Equatable {
    /// User confirmed transfer (slide pill released past threshold).
    case slideConfirmed
    /// Biometrics step started.
    case biometricsRequested
    /// Biometrics result observed.
    case biometricsResult(BiometricsResult)
    /// Pre-flight gate refused the submit (rate stale / refreshed /
    /// already in flight). Reason is the matching enum case name.
    case submitRefused(String)
    /// Backend POST issued.
    case postCreateIssued(idempotencyKey: String)
    /// Backend POST succeeded.
    case postCreateSucceeded(transferId: String)
    /// Backend POST failed; reason is the mapped APIError case name.
    case postCreateFailed(reason: String)
}

public protocol TransferAuditLogger: Sendable {
    func log(_ action: TransferAuditAction)
}

/// No-op default. Production callers explicitly inject a real
/// implementation; tests can inject `CapturingTransferAuditLogger`.
public struct NoOpTransferAuditLogger: TransferAuditLogger {
    public init() {}
    public func log(_ action: TransferAuditAction) {
        _ = action
    }
}

#if DEBUG
public final class CapturingTransferAuditLogger: TransferAuditLogger, @unchecked Sendable {
    private let lock = NSLock()
    private var _entries: [TransferAuditAction] = []

    public init() {}

    public func log(_ action: TransferAuditAction) {
        lock.lock()
        defer { lock.unlock() }
        _entries.append(action)
    }

    public var entries: [TransferAuditAction] {
        lock.lock()
        defer { lock.unlock() }
        return _entries
    }
}
#endif
