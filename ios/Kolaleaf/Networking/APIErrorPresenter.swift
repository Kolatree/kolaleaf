// APIErrorPresenter.swift
// Free function (and namespace) for translating an `APIError` into a
// user-facing string. Lives in Networking/ alongside `APIError` so the
// presentation layer for an error is co-located with its definition.
//
// OO-001 fix: previously duplicated as a private `userFacingMessage(for:)`
// helper inside both `ConfirmProfileViewModel` and
// `ConfirmAddressViewModel` — identical bodies modulo the fallback
// string. Centralising removes the cut-and-paste drift risk for the next
// VM that needs the same translation.
//
// The fallback string is per-screen (e.g. "Couldn't save your address.")
// so callers pass it explicitly. Returning `String` (not `String?`)
// guarantees a non-nil banner copy.
//
// API-009: a typed `SaveError` lives in the same file because the
// View-facing presentation logic for both flows (string + retry hint
// + dismiss/keep-on-screen branching) belongs in one module. Keeping
// `SaveError` here avoids a separate import path for a tiny shared
// type.

import Foundation

public enum APIErrorPresenter {

    /// Translate an `APIError` into a user-facing message.
    /// - Parameters:
    ///   - error: the failure surfaced by `APIClient.send`.
    ///   - fallback: per-screen copy used for the default branch.
    /// - Returns: a non-nil string suitable for an error banner.
    public static func userFacingMessage(
        for error: APIError,
        fallback: String
    ) -> String {
        switch error {
        case .unauthorized:
            return "Your session expired. Please sign in again."
        case .transport:
            return "Connection problem. Please check your network and try again."
        case .rateLimited(let retryAfter):
            return "Too many attempts. Try again in \(Int(retryAfter)) seconds."
        default:
            return error.errorDescription ?? fallback
        }
    }
}

// MARK: - SaveError (API-009)

/// Typed error surfaced by save-style ViewModels (Confirm Profile,
/// Confirm Address) so callers can branch on case identity rather
/// than match on a free-form string. The associated values carry the
/// machine-readable hints the UI needs (rate-limit `retryAfter`,
/// validation field map) without forcing every consumer to re-parse
/// an opaque message.
///
/// Why a dedicated type rather than re-exporting `APIError`:
///   • `APIError` is the network layer's vocabulary (transport,
///     decode, kycRequired, …). Most of that doesn't surface from a
///     PostKYC save and would force every View to handle cases that
///     can never happen there.
///   • Branching in the View (e.g. dismiss the modal on
///     `sessionExpired`, show the retry timer on `rateLimited`)
///     becomes a switch on a small, exhaustive enum.
///   • The display string lives on the type itself
///     (`displayMessage`) so the View only needs the VM's
///     `lastError?.displayMessage`.
public enum SaveError: Sendable, Equatable {
    /// HTTP 401 / session no longer valid. UI should bounce back to
    /// the sign-in screen rather than retry on the same screen.
    case sessionExpired
    /// DNS / offline / TLS failure. Retry is reasonable.
    case network
    /// HTTP 429. `retryAfter` (seconds) carries the server hint.
    case rateLimited(retryAfter: TimeInterval?)
    /// HTTP 422 — schema validation failed server-side.
    case validation(message: String)
    /// Pre-flight: the user changed the bank or account number after
    /// the resolve completed but before tapping Save. The previously
    /// confirmed account holder no longer corresponds to the input,
    /// so the save was refused locally to prevent routing funds to
    /// the wrong recipient (ADV-001 fix). UI should re-trigger the
    /// resolve and re-show the holder card before letting the user
    /// retry.
    case detailsChangedWhileSaving
    /// Anything else (5xx, decode errors, unforeseen reason). UI
    /// shows the message verbatim with the per-screen fallback.
    case unknown(message: String)

    /// Build a `SaveError` from an `APIError` + per-screen fallback
    /// copy. Centralised so each VM doesn't reinvent the mapping.
    public static func from(_ error: APIError, fallback: String) -> SaveError {
        switch error {
        case .unauthorized:
            return .sessionExpired
        case .transport:
            return .network
        case .rateLimited(let retryAfter):
            return .rateLimited(retryAfter: retryAfter)
        case .validation:
            return .validation(message: APIErrorPresenter.userFacingMessage(
                for: error, fallback: fallback))
        default:
            return .unknown(message: APIErrorPresenter.userFacingMessage(
                for: error, fallback: fallback))
        }
    }

    /// Non-nil banner copy. Delegates to `APIErrorPresenter` for the
    /// canonical strings so this layer never drifts from the rest of
    /// the app's error vocabulary.
    public var displayMessage: String {
        switch self {
        case .sessionExpired:
            return "Your session expired. Please sign in again."
        case .network:
            return "Connection problem. Please check your network and try again."
        case .rateLimited(let retryAfter):
            let seconds = Int(retryAfter ?? 5)
            return "Too many attempts. Try again in \(seconds) seconds."
        case .detailsChangedWhileSaving:
            return "The bank or account number changed. We'll re-confirm the holder before saving."
        case .validation(let message), .unknown(let message):
            return message
        }
    }
}
