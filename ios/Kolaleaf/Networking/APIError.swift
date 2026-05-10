// APIError.swift  (Phase 0 · U10)
// Backend-aware error taxonomy. Maps HTTP status + backend `reason` strings (the
// machine-readable code) to distinct cases so ViewModels can choose appropriate UI.
//
// r2-review fix · 2026-05-09: backend envelope is `{ error: string, reason: string }`
// (not nested `{error: {code, message}}`). `reason` is the machine code, `error` is
// the human message. APIError.map now extracts `reason` for dispatch.

import Foundation

public enum APIError: Error, Equatable, Sendable {
    /// Network or transport failure (DNS, offline, TLS, etc.). Body is empty.
    case transport(String)
    /// HTTP 401 — session expired or invalid.
    case unauthorized
    /// HTTP 402 OR `reason == "kyc_not_verified"` — request hit a KYC gate.
    case kycRequired
    /// HTTP 403 — authenticated but not allowed (admin endpoint, role mismatch).
    case forbidden
    /// HTTP 404 — resource not present.
    case notFound
    /// 5xx / timeout from a downstream provider (Flutterwave, Monoova) for resolve / status.
    case bankUnreachable
    /// Rate-quote expired between quote and submit. Backend uses `reason: "rate_expired"`.
    case rateExpired
    /// HTTP 429 — rate-limited. `retryAfter` carries the server hint in seconds.
    case rateLimited(retryAfter: TimeInterval)
    /// HTTP 422 — request body failed Zod validation. Field-level errors keyed by path.
    case validation(fields: [String: [String]])
    /// HTTP 5xx (other than bankUnreachable). Generic internal server error.
    case server(status: Int, message: String?)
    /// JSON decoding failure. Indicates a contract drift between iOS DTOs and backend.
    case decode(String)
    /// Step-up auth required. Backend (future) returns 401 with `reason == "stepup_required"`.
    case stepUpRequired(intent: String)
    /// Login 202: password OK but email unverified. `email` carried for the verify-screen redirect.
    case verificationRequired(email: String, message: String)
    /// Wrong / expired / used 6-digit code at /verify-code. Backend reasons: "wrong_code", "expired", "used", "no_token".
    case codeInvalid(reason: String)
}

extension APIError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .transport(let msg):       return "Connection problem: \(msg)"
        case .unauthorized:             return "Your session has expired. Please sign in again."
        case .kycRequired:              return "Verify your identity to continue."
        case .forbidden:                return "You don't have permission to do that."
        case .notFound:                 return "We couldn't find that."
        case .bankUnreachable:          return "Couldn't reach the bank. We'll keep trying."
        case .rateExpired:              return "The exchange rate has refreshed. Tap to use the new rate."
        case .rateLimited(let after):   return "Too many requests. Try again in \(Int(after)) seconds."
        case .validation:               return "Some details need fixing."
        case .server(let status, let msg): return msg ?? "Something went wrong on our side (\(status))."
        case .decode:                   return "Something went wrong. Please try again."
        case .stepUpRequired:           return "Confirm with your authenticator app to continue."
        case .verificationRequired:     return "Please verify your email to sign in."
        case .codeInvalid(let r):
            switch r {
            case "wrong_code": return "That code didn't match. Please try again."
            case "expired":    return "That code has expired. Tap Resend to get a new one."
            case "used":       return "That code has already been used."
            case "no_token":   return "Please request a new code first."
            default:           return "Could not verify the code. Please try again."
            }
        }
    }
}

// MARK: - Backend error mapping

extension APIError {
    /// Maps a backend `{ error, reason }` payload + HTTP status to the right case.
    /// `reason` matches strings the Next.js routes return (see src/app/api/v1/*/route.ts
    /// + src/lib/auth/responses.ts jsonError helper).
    public static func map(
        httpStatus: Int,
        reason: String?,
        message: String?,
        fields: [String: [String]]? = nil,
        retryAfter: TimeInterval? = nil
    ) -> APIError {
        // reason-based dispatch wins over status when both are present.
        switch reason {
        case "kyc_required", "kyc_not_verified":
            return .kycRequired
        case "rate_expired":
            return .rateExpired
        case "stepup_required":
            return .stepUpRequired(intent: message ?? "transfer.create")
        case "bank_unreachable":
            return .bankUnreachable
        case "wrong_code", "expired", "used", "no_token":
            return .codeInvalid(reason: reason!)
        default:
            break
        }

        switch httpStatus {
        case 401:           return .unauthorized
        case 402:           return .kycRequired
        case 403:           return .forbidden
        case 404:           return .notFound
        case 422:           return .validation(fields: fields ?? [:])
        case 429:           return .rateLimited(retryAfter: retryAfter ?? 5)
        case 500..<600:     return .server(status: httpStatus, message: message)
        default:            return .server(status: httpStatus, message: message)
        }
    }
}

// MARK: - Equatable

extension APIError {
    public static func == (lhs: APIError, rhs: APIError) -> Bool {
        switch (lhs, rhs) {
        case (.transport(let a), .transport(let b)):                  return a == b
        case (.unauthorized, .unauthorized):                          return true
        case (.kycRequired, .kycRequired):                            return true
        case (.forbidden, .forbidden):                                return true
        case (.notFound, .notFound):                                  return true
        case (.bankUnreachable, .bankUnreachable):                    return true
        case (.rateExpired, .rateExpired):                            return true
        case (.rateLimited(let a), .rateLimited(let b)):              return a == b
        case (.validation(let a), .validation(let b)):                return a == b
        case (.server(let a1, let a2), .server(let b1, let b2)):      return a1 == b1 && a2 == b2
        case (.decode(let a), .decode(let b)):                        return a == b
        case (.stepUpRequired(let a), .stepUpRequired(let b)):        return a == b
        case (.verificationRequired(let a1, let a2), .verificationRequired(let b1, let b2)):
            return a1 == b1 && a2 == b2
        case (.codeInvalid(let a), .codeInvalid(let b)):              return a == b
        default:                                                       return false
        }
    }
}
