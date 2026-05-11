// RecipientResolveService.swift  (Phase 4 · U37 — Iteration 2)
// Debounced bank-account-name lookup. The Add Recipient form re-calls
// `resolve(_:_:)` every time the bank or account number changes; this
// service collapses fast typing into a single API call and exposes
// the result as a `@Observable` `state` property the View binds to.
//
// Iteration 2 fixes (ADV-001, ADV-003, OO-002, OO-003, CA-007):
//   • `ResolveState` now carries the (bankCode, accountNumber) tuple
//     that produced each terminal state so the consumer (the VM) can
//     verify, at save-time, that the user did not change the input
//     after the resolve completed. Without this correlation, a "Adaeze"
//     resolution can stale-leak past a bank or NUBAN edit and route
//     funds to a stranger (money-routing risk).
//   • `scheduleResolve()` (the entry point in the VM) now SYNCHRONOUSLY
//     resets the state to `.idle` BEFORE enqueuing the debounced task
//     — that closes the 300 ms window where the prior `.resolved` value
//     would survive a fresh keystroke. We mirror the same reset here
//     so the service is safe to call directly too.
//   • A 401 from the resolve endpoint maps to `.sessionExpired` (a
//     distinct state), not the catch-all `.bankDown`. Otherwise the
//     user is trapped in a "bank unreachable" loop forever and a
//     future auto-retry hammers the endpoint.
//   • `.bankDown` carries the `retryAfter` hint when the underlying
//     APIError was `.rateLimited` so a Phase 5 auto-retry can honor
//     it (OO-002).
//
// Threading / concurrency:
//   • `@MainActor`-isolated. The Add Recipient screen reads `state`
//     from the View body; SwiftUI's Observation framework requires
//     the published property to be touched on the same actor as the
//     observer (the View body runs on MainActor).
//   • In-flight task is held in `inflightTask` and cancelled
//     pre-emptively on every new resolve call. Callers don't have to
//     remember to cancel — typing fast does the right thing
//     automatically.
//
// Validation:
//   • bankCode must be non-empty
//   • accountNumber must be exactly 10 ASCII digits (matches the
//     backend's `^\d{10}$`; JS RegExp `\d` is ASCII-only).
//   Any failure short-circuits to `.idle` without an API call so
//   partial input never wastes a round-trip or shows a transient
//   `.resolving` flash.

import Foundation
import Observation

/// What the View renders. Each non-`.idle` case carries the
/// (bankCode, accountNumber) pair that produced it so the calling VM
/// can ASSERT, at save-time, that the user did not change the input
/// after the resolve completed.
public enum ResolveState: Sendable, Equatable {
    case idle
    case resolving(forBankCode: String, forAccountNumber: String)
    case resolved(name: String, forBankCode: String, forAccountNumber: String)
    case notFound(forBankCode: String, forAccountNumber: String)
    /// Underlying provider was unreachable (5xx, transport, rate-limit).
    /// `retryAfter` carries the rate-limit hint when present so a
    /// Phase 5 auto-retry can honor the server-side cooldown.
    case bankDown(forBankCode: String, forAccountNumber: String, retryAfter: TimeInterval?)
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
    public static let debounce: Duration = .milliseconds(300)

    private let api: AuthAPI
    private var inflightTask: Task<Void, Never>?

    public init(api: AuthAPI) {
        self.api = api
    }

    /// Re-trigger the debounced resolve. Safe to call on every
    /// keystroke; the in-flight task is cancelled pre-emptively so
    /// only the latest input ever resolves.
    ///
    /// **Synchronous invariant:** before the debounce is enqueued,
    /// `state` is reset to `.idle`. This closes the 300 ms window
    /// where a stale `.resolved` value would survive a fresh
    /// keystroke and let the View's "Save" CTA stay enabled against
    /// outdated input. The VM relies on this to keep `canSave`
    /// honest.
    public func resolve(bankCode: String, accountNumber: String) async {
        // Cancel any prior debounce-in-progress (or in-flight call).
        // The prior task's continuation will see Task.isCancelled and
        // exit without touching `state`.
        inflightTask?.cancel()
        // Synchronously drop to idle so a stale `.resolved` cannot
        // outlive the input change (ADV-001 fix). This must happen
        // BEFORE the validation gate so a transient "valid → partial"
        // flick (delete one digit) clears the resolved name even
        // though no new task gets enqueued.
        state = .idle

        guard Self.isValidInput(bankCode: bankCode, accountNumber: accountNumber) else {
            inflightTask = nil
            return
        }

        // Capture the input the task is going to resolve so the
        // terminal-state cases carry the same tuple even if the VM
        // mutates its own bindings while the network call is in
        // flight.
        let capturedBank = bankCode
        let capturedAccount = accountNumber

        let task = Task { @MainActor [api] in
            // Debounce. If the user keeps typing, this whole task is
            // cancelled before the sleep returns and we never call
            // the API.
            try? await Task.sleep(for: Self.debounce)
            guard !Task.isCancelled else { return }

            self.state = .resolving(
                forBankCode: capturedBank,
                forAccountNumber: capturedAccount
            )

            let result = await api.send(
                RecipientsEndpoints.Resolve(
                    bankCode: capturedBank,
                    accountNumber: capturedAccount
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
                    forBankCode: capturedBank,
                    forAccountNumber: capturedAccount
                )
            case .failure(let error):
                self.state = Self.mapErrorToState(
                    error,
                    bankCode: capturedBank,
                    accountNumber: capturedAccount
                )
            }
        }
        inflightTask = task
    }

    /// Reset to `.idle` and cancel any in-flight resolve. Use when
    /// the View dismisses the Add Recipient sheet so a stale resolve
    /// can't leak into the next presentation.
    public func reset() {
        inflightTask?.cancel()
        inflightTask = nil
        state = .idle
    }

    // MARK: - Pure helpers (testable in isolation)

    /// True when the input passes the same shape rules the backend
    /// enforces server-side. ASCII-only digits — Unicode-Nd would
    /// otherwise sneak through `Character.isNumber`.
    static func isValidInput(bankCode: String, accountNumber: String) -> Bool {
        guard !bankCode.isEmpty else { return false }
        guard accountNumber.count == 10 else { return false }
        return accountNumber.allSatisfy { $0.isASCII && $0.isNumber }
    }

    /// Map an `APIError` to a `ResolveState`. Three distinct UI
    /// branches: `.notFound`, `.sessionExpired` (401), and the
    /// catch-all `.bankDown` for everything else (5xx / transport /
    /// rate-limit). The (bankCode, accountNumber) tuple is included
    /// in the terminal state so the VM can correlate the state back
    /// to the input that produced it (ADV-001 fix).
    static func mapErrorToState(
        _ error: APIError,
        bankCode: String,
        accountNumber: String
    ) -> ResolveState {
        switch error {
        case .notFound:
            return .notFound(
                forBankCode: bankCode,
                forAccountNumber: accountNumber
            )
        case .unauthorized:
            // ADV-003 fix: a 401 during resolve must not collapse
            // into the catch-all "bank unreachable" message — the
            // user has to re-auth, not retry.
            return .sessionExpired
        case .rateLimited(let retryAfter):
            // OO-002 fix: surface the server-side retry hint so a
            // Phase 5 auto-retry can wait the right amount.
            return .bankDown(
                forBankCode: bankCode,
                forAccountNumber: accountNumber,
                retryAfter: retryAfter
            )
        default:
            return .bankDown(
                forBankCode: bankCode,
                forAccountNumber: accountNumber,
                retryAfter: nil
            )
        }
    }
}
