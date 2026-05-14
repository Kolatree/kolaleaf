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

// `AUState` lives in `App/AUState.swift` so PostKYC, Recipients, and any
// future cross-feature surface can reference the domain enum without
// importing Onboarding (CA-001).

@MainActor
@Observable
public final class RegistrationDetailsViewModel {

    // D4b: identifier carries the rail (email | phone) selected at
    // the OTP step. Rail-specific projections (field key, noun,
    // string value) live on `LoginIdentifier` itself so View / VM
    // call sites read them via helper accessors rather than
    // re-implementing the rail→noun mapping (iter-2 fix API-403 /
    // OO-001).
    public let identifier: LoginIdentifier
    public var fullName: String = ""
    public var password: String = ""
    public var addressLine1: String = ""
    public var addressLine2: String = ""
    public var city: String = ""
    public var state: AUState = .nsw
    public var postcode: String = ""

    public private(set) var isSubmitting: Bool = false
    /// Field-keyed error messages. The "form" key carries form-level
    /// errors (claim_expired, transport, etc.) that don't map to a
    /// single field. `identifier.fieldKey` selects which key a 409
    /// lands on ("email" or "phone") so the rail-appropriate input
    /// shows the error.
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

    // iter-2 review fix (API-402 / API-403): only the identifier-taking
    // init remains. The string-rail conveniences (`init(email:)`,
    // `init(phone:)`) were removed so the typed LoginIdentifier enum
    // reaches every construction site intact.
    public init(
        identifier: LoginIdentifier,
        api: AuthAPI,
        onRegistered: @escaping (CurrentUser) -> Void
    ) {
        self.identifier = identifier
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
            inlineErrors["form"] = String(
                localized: "onboarding.register.fields_required",
                defaultValue: "Please complete all required fields."
            )
            return
        }

        isSubmitting = true
        inlineErrors = [:]
        defer { isSubmitting = false }

        let body = CompleteRegistrationRequest(
            identifier: identifier,
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
            // iter-2 review fix (API-403): switch over the typed
            // identifier so the rail dictates the CurrentUser fields
            // — no projection through optional accessors on the VM.
            let railEmail: String?
            let railPhone: String?
            switch identifier {
            case .email(let v):
                railEmail = v
                railPhone = nil
            case .phone(let p):
                railEmail = nil
                railPhone = p.e164
            }
            let user = CurrentUser(
                id: response.user.id,
                displayName: response.user.fullName,
                legalName: response.user.fullName,
                email: railEmail,
                phone: railPhone
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
                inlineErrors["form"] = String(
                    localized: "onboarding.register.details_need_fixing",
                    defaultValue: "Some details need fixing."
                )
            }

        case .server(let status, let message) where status == 409:
            let fallback: String
            switch identifier {
            case .email:
                fallback = String(
                    localized: "onboarding.register.email_taken",
                    defaultValue: "This email is already registered."
                )
            case .phone:
                fallback = String(
                    localized: "onboarding.register.phone_taken",
                    defaultValue: "This phone number is already registered."
                )
            }
            inlineErrors[identifier.fieldKey] = message ?? fallback

        case .server(let status, let message) where status == 400:
            // Business-logic 400 (claim_expired / pending_not_verified / etc.).
            // Surface a friendly form-level message; the literal reason makes
            // the underlying state visible to QA.
            let reason = message ?? "request_failed"
            inlineErrors["form"] = recoverableMessage(forReason: reason)

        case .rateLimited(let retryAfter):
            inlineErrors["form"] = String(
                localized: "common.error.rate_limited",
                defaultValue: "Too many attempts. Try again in \(Int(retryAfter)) seconds."
            )

        case .transport:
            inlineErrors["form"] = String(
                localized: "common.error.connection",
                defaultValue: "Connection problem. Please check your network."
            )

        default:
            inlineErrors["form"] = error.errorDescription ?? String(
                localized: "common.error.unknown",
                defaultValue: "Something went wrong. Please try again."
            )
        }
    }

    private func recoverableMessage(forReason reason: String) -> String {
        // iter-2 review fix (API-403): rail noun sourced from
        // `LoginIdentifier.railNoun` so the rail→noun mapping has a
        // single source of truth.
        switch reason {
        case "claim_expired":
            return String(
                localized: "onboarding.register.claim_expired",
                defaultValue: "Your verification expired. Please restart sign-up."
            )
        case "pending_not_verified":
            return String(
                localized: "onboarding.register.pending_not_verified",
                defaultValue: "Please verify your \(identifier.railNoun) before completing sign-up."
            )
        default:
            return String(
                localized: "onboarding.register.failed_generic",
                defaultValue: "We couldn't complete sign-up. Please try again."
            )
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
