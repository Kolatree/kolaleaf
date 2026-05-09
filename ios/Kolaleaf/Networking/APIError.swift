// APIError.swift  (Phase 0 · U10)
// Backend-aware error taxonomy. Maps HTTP status + backend `error.code` strings to
// distinct cases so ViewModels can choose appropriate UI without parsing raw responses.

import Foundation

public enum APIError: Error, Equatable, Sendable {
    /// Network or transport failure (DNS, offline, TLS, etc.). Body is empty.
    case transport(String)

    /// HTTP 401 — session expired or invalid. AuthInterceptor force-logs-out.
    case unauthorized

    /// HTTP 402 / `error.code = "kyc_required"` — request hit a KYC gate.
    case kycRequired

    /// HTTP 403 — authenticated but not allowed (admin endpoint, role mismatch).
    case forbidden

    /// HTTP 404 — resource not present. Special-cased for NUBAN resolve (ResolveNotFound).
    case notFound

    /// 5xx / timeout from a downstream provider (Flutterwave, Monoova) when calling
    /// resolve or status APIs. Surfaces as the amber "Bank unreachable" card.
    case bankUnreachable

    /// HTTP 412 — rate has expired between quote and submit. ViewModel must refresh.
    case rateExpired

    /// HTTP 429 — rate-limited. `retryAfter` carries the server hint in seconds.
    case rateLimited(retryAfter: TimeInterval)

    /// HTTP 422 — request body failed Zod validation. Field-level errors keyed by path.
    case validation([String: String])

    /// HTTP 5xx (other than bankUnreachable). Generic internal server error.
    case server(status: Int, message: String?)

    /// JSON decoding failure. Indicates a contract drift between iOS DTOs and backend.
    case decode(String)

    /// Step-up auth required (per R25). Backend returned 401 with `error.code = "stepup_required"`.
    case stepUpRequired(intent: String)
}

extension APIError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .transport(let msg):
            return "Connection problem: \(msg)"
        case .unauthorized:
            return "Your session has expired. Please sign in again."
        case .kycRequired:
            return "Verify your identity to continue."
        case .forbidden:
            return "You don't have permission to do that."
        case .notFound:
            return "We couldn't find that."
        case .bankUnreachable:
            return "Couldn't reach the bank. We'll keep trying."
        case .rateExpired:
            return "The exchange rate has refreshed. Tap to use the new rate."
        case .rateLimited(let after):
            return "Too many requests. Try again in \(Int(after)) seconds."
        case .validation:
            return "Some details need fixing."
        case .server(let status, let msg):
            return msg ?? "Something went wrong on our side (\(status))."
        case .decode:
            // Decoding errors should never reach end-users; surface a neutral message.
            return "Something went wrong. Please try again."
        case .stepUpRequired:
            return "Confirm with your authenticator app to continue."
        }
    }
}

// MARK: - Backend error mapping

extension APIError {
    /// Maps a backend `{ error: { code, message } }` payload + HTTP status to the right case.
    /// `code` matches the strings the Next.js routes return (see src/app/api/v1/*/route.ts).
    public static func map(httpStatus: Int, code: String?, message: String?, retryAfter: TimeInterval? = nil) -> APIError {
        // Code-based dispatch wins over status when both are present.
        switch code {
        case "kyc_required", "kyc_not_verified":
            return .kycRequired
        case "rate_expired":
            return .rateExpired
        case "stepup_required":
            return .stepUpRequired(intent: message ?? "transfer.create")
        case "bank_unreachable":
            return .bankUnreachable
        default:
            break
        }

        switch httpStatus {
        case 401:           return .unauthorized
        case 402:           return .kycRequired
        case 403:           return .forbidden
        case 404:           return .notFound
        case 412:           return .rateExpired
        case 422:           return .validation([:])
        case 429:           return .rateLimited(retryAfter: retryAfter ?? 5)
        case 500..<600:     return .server(status: httpStatus, message: message)
        default:            return .server(status: httpStatus, message: message)
        }
    }
}
