// ResolveErrorMapper.swift  (Phase 5 · OO-105 — iteration 3)
// Pure mapping from `APIError` to `ResolveState`. Extracted out of
// `RecipientResolveService` so the policy lives at the domain layer
// and is exhaustively testable without standing up the service.
//
// Three distinct UI branches:
//   • `.notFound` — backend confirmed no such account at this bank.
//   • `.sessionExpired` — HTTP 401. The remedy is "sign in again",
//     not "wait + retry"; routing it through `.bankDown` would trap
//     the user in a "bank unreachable" loop forever (ADV-003).
//   • `.bankDown` — everything else (5xx, transport, rate-limit). The
//     `retryAfter` hint from a 429 rides through so the auto-retry
//     timer can honour the server-side cooldown (OO-002).
//
// The (bankCode, accountNumber) tuple is included in the terminal
// state so the VM can correlate the state back to the input that
// produced it (ADV-001 fix).
//
// Iter-3 (API-202): ResolveState case labels lost their `for`
// preposition; mapped construction sites updated accordingly.

import Foundation

public enum ResolveErrorMapper {

    public static func map(
        _ error: APIError,
        bankCode: String,
        accountNumber: String
    ) -> ResolveState {
        switch error {
        case .notFound:
            return .notFound(
                bankCode: bankCode,
                accountNumber: accountNumber
            )
        case .unauthorized:
            return .sessionExpired
        case .rateLimited(let retryAfter):
            return .bankDown(
                bankCode: bankCode,
                accountNumber: accountNumber,
                retryAfter: retryAfter
            )
        default:
            return .bankDown(
                bankCode: bankCode,
                accountNumber: accountNumber,
                retryAfter: nil
            )
        }
    }
}
