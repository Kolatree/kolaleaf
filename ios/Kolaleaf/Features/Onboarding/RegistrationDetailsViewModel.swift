// RegistrationDetailsViewModel.swift  (Phase 1 · U21a)
// Drives the post-OTP registration form (name, password, AU address) and
// invokes /auth/complete-registration to consume the verified email claim.
//
// Validation strategy: client-side rules mirror the backend Zod schema so
// users see most errors before a network round-trip; the backend remains
// authoritative — any 422 from the server overwrites the local message
// for the affected field. 409 is mapped to the email field; 400-with-reason
// produces a form-level message ("form" key in `inlineErrors`).

import Foundation
import Observation

public enum AUState: String, CaseIterable, Sendable {
    case nsw = "NSW"
    case vic = "VIC"
    case qld = "QLD"
    case wa  = "WA"
    case sa  = "SA"
    case tas = "TAS"
    case act = "ACT"
    case nt  = "NT"
}

@MainActor
@Observable
public final class RegistrationDetailsViewModel {

    public let email: String
    public var fullName: String = ""
    public var password: String = ""
    public var addressLine1: String = ""
    public var addressLine2: String = ""
    public var city: String = ""
    public var state: AUState = .nsw
    public var postcode: String = ""

    public private(set) var isSubmitting: Bool = false
    /// Field-keyed error messages. The "form" key carries form-level errors
    /// (claim_expired, transport, etc.) that don't map to a single field.
    public private(set) var inlineErrors: [String: String] = [:]

    public var canSubmit: Bool {
        guard !isSubmitting else { return false }
        return Self.isValidName(fullName.trimmed())
            && Self.isValidPassword(password)
            && Self.isValidAddressLine1(addressLine1.trimmed())
            && Self.isValidCity(city.trimmed())
            && Self.isValidPostcode(postcode)
    }

    private let api: AuthAPI
    private let onRegistered: (CurrentUser) -> Void

    public init(email: String, api: AuthAPI, onRegistered: @escaping (CurrentUser) -> Void) {
        self.email = email
        self.api = api
        self.onRegistered = onRegistered
    }

    public func submit() async {
        let trimmedName = fullName.trimmed()
        let trimmedAddress1 = addressLine1.trimmed()
        let trimmedAddress2 = addressLine2.trimmed()
        let trimmedCity = city.trimmed()

        // Local validation gate — matches `canSubmit` so submit() is robust against
        // direct callers that bypass the disabled CTA.
        guard Self.isValidName(trimmedName),
              Self.isValidPassword(password),
              Self.isValidAddressLine1(trimmedAddress1),
              Self.isValidCity(trimmedCity),
              Self.isValidPostcode(postcode) else {
            inlineErrors["form"] = "Please complete all required fields."
            return
        }

        isSubmitting = true
        inlineErrors = [:]
        defer { isSubmitting = false }

        let body = CompleteRegistrationRequest(
            email: email,
            fullName: trimmedName,
            password: password,
            addressLine1: trimmedAddress1,
            addressLine2: trimmedAddress2.isEmpty ? nil : trimmedAddress2,
            city: trimmedCity,
            state: state.rawValue,
            postcode: postcode
        )

        let result = await api.send(AuthEndpoints.CompleteRegistration(body))
        switch result {
        case .success(let response):
            let user = CurrentUser(
                id: response.user.id,
                displayName: response.user.fullName,
                legalName: response.user.fullName,
                email: email,
                phone: nil
            )
            onRegistered(user)
        case .failure(let error):
            apply(error: error)
        }
    }

    // MARK: - Error mapping

    private func apply(error: APIError) {
        switch error {
        case .validation(let fields):
            for (key, messages) in fields {
                if let first = messages.first {
                    inlineErrors[key] = first
                }
            }
            if inlineErrors.isEmpty {
                inlineErrors["form"] = "Some details need fixing."
            }

        case .server(let status, let message) where status == 409:
            inlineErrors["email"] = message ?? "This email is already registered."

        case .server(let status, let message) where status == 400:
            // Business-logic 400 (claim_expired / pending_not_verified / etc.).
            // Surface a friendly form-level message; the literal reason makes
            // the underlying state visible to QA.
            let reason = message ?? "request_failed"
            inlineErrors["form"] = recoverableMessage(forReason: reason)

        case .rateLimited(let retryAfter):
            inlineErrors["form"] = "Too many attempts. Try again in \(Int(retryAfter)) seconds."

        case .transport:
            inlineErrors["form"] = "Connection problem. Please check your network."

        default:
            inlineErrors["form"] = error.errorDescription ?? "Something went wrong. Please try again."
        }
    }

    private func recoverableMessage(forReason reason: String) -> String {
        switch reason {
        case "claim_expired":         return "Your verification expired. Please restart sign-up."
        case "pending_not_verified":  return "Please verify your email before completing sign-up."
        default:                       return "We couldn't complete sign-up. Please try again."
        }
    }

    // MARK: - Validators (mirror backend Zod rules, intentionally narrower
    // when the wire schema would let through edge cases that the UX won't show)

    private static let nameLetterRegex = try! NSRegularExpression(pattern: #"\p{L}"#)
    private static let postcodeRegex = try! NSRegularExpression(pattern: #"^\d{4}$"#)
    private static let digitRegex   = try! NSRegularExpression(pattern: #"\d"#)
    private static let letterRegex  = try! NSRegularExpression(pattern: #"\p{L}"#)

    private static func isValidName(_ value: String) -> Bool {
        let count = value.count
        guard (2...200).contains(count) else { return false }
        let range = NSRange(value.startIndex..., in: value)
        return nameLetterRegex.firstMatch(in: value, options: [], range: range) != nil
    }

    private static func isValidPassword(_ value: String) -> Bool {
        guard (12...128).contains(value.count) else { return false }
        let range = NSRange(value.startIndex..., in: value)
        let hasLetter = letterRegex.firstMatch(in: value, options: [], range: range) != nil
        let hasDigit = digitRegex.firstMatch(in: value, options: [], range: range) != nil
        return hasLetter && hasDigit
    }

    private static func isValidAddressLine1(_ value: String) -> Bool {
        (3...200).contains(value.count)
    }

    private static func isValidCity(_ value: String) -> Bool {
        (1...100).contains(value.count)
    }

    private static func isValidPostcode(_ value: String) -> Bool {
        let range = NSRange(value.startIndex..., in: value)
        return postcodeRegex.firstMatch(in: value, options: [], range: range) != nil
    }
}

// MARK: - String trim helper

private extension String {
    func trimmed() -> String {
        trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
