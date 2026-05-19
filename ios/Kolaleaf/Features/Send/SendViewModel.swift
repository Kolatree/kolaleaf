// SendViewModel.swift  (Phase 6 iter-2 · C1/C2/C6 + W11/W21)
// Thin coordinator. Delegates rate-quote management to
// `RateQuoteService` and transfer submission to
// `TransferSubmissionService`. All money-path invariants live in the
// services; this file is glue between the SwiftUI surface and those
// services.
//
// Iter-2 closes (per the iter-1 review):
//   • C1 / OO-001 — god-class decomposed; this VM no longer owns
//     network calls or idempotency-key lifecycle.
//   • C2 / API-001 — `submitTransfer(...)` is no longer public. The
//     only entry point is `confirmAndSubmit()`; the underlying submit
//     is `internal` on `TransferSubmissionService` and gets exercised
//     end-to-end.
//   • C6 / ADV-P6-C4 — no fake `local-pending` ActiveTransfer. The
//     submission service flips `AppState.isSubmittingTransfer` for
//     the idle window, and writes a real `activeTransfer` only on
//     backend success. The created Transfer is consumed via
//     `consumeLastCreated()` so re-entrant view re-renders cannot
//     re-route navigation.
//   • W11 — in-flight booleans renamed to `is<Verb>InFlight` pattern
//     where possible; `isSubmittingTransfer` mirrors AppState.
//   • W21 / ADV-P6-W4 — `APIError.unauthorized` maps to
//     `.sessionExpired`; SendView routes to login.

import Foundation
import Observation

public enum SendError: Equatable, Sendable {
    case kycBlocked
    case rateStale
    case recipientNotOwned
    case amountOutOfRange
    case dailyLimitExceeded
    case invalidCorridor
    case emailUnverified
    case idempotencyKeyConflict
    case rateLoadFailed
    case sessionExpired
    /// Last-resort opaque bucket. Reserve for non-transport unknowns;
    /// genuine network/transport failures use `.transport`.
    case unknown(String)
    case transport(String)

    /// Human-facing message; SendView routes this to the error banner.
    public var message: String {
        switch self {
        case .kycBlocked:
            return String(
                localized: "send.error.kyc_blocked",
                defaultValue: "We need to re-verify your identity before this transfer can go through."
            )
        case .rateStale:
            return String(
                localized: "send.error.rate_stale",
                defaultValue: "The exchange rate changed before we could send. Slide again to retry."
            )
        case .recipientNotOwned:
            return String(
                localized: "send.error.recipient_not_owned",
                defaultValue: "This recipient is no longer available. Pick another."
            )
        case .amountOutOfRange:
            return String(
                localized: "send.error.amount_out_of_range",
                defaultValue: "That amount is outside today's limits."
            )
        case .dailyLimitExceeded:
            return String(
                localized: "send.error.daily_limit_exceeded",
                defaultValue: "You've reached today's transfer limit. Try again tomorrow."
            )
        case .invalidCorridor:
            return String(
                localized: "send.error.invalid_corridor",
                defaultValue: "That currency corridor isn't available right now."
            )
        case .emailUnverified:
            return String(
                localized: "send.error.email_unverified",
                defaultValue: "Please verify your email before sending money."
            )
        case .idempotencyKeyConflict:
            return String(
                localized: "send.error.idempotency_conflict",
                defaultValue: "We already received an earlier version of this transfer. Refresh and try again."
            )
        case .rateLoadFailed:
            return String(
                localized: "send.error.rate_load_failed",
                defaultValue: "Couldn't load the latest exchange rate. Try again."
            )
        case .sessionExpired:
            return String(
                localized: "common.error.session_expired",
                defaultValue: "Your session has expired. Please sign in again."
            )
        case .unknown(let msg):
            return msg
        case .transport(let msg):
            return msg
        }
    }
}

public enum SendSubmitBlocker: Equatable, Sendable {
    case submitting
    case missingRecipient
    case missingRate
    case emptyAmount
}

@MainActor
@Observable
public final class SendViewModel {

    // MARK: - Dependencies

    private let rateService: RateQuoteService
    private let submitter: TransferSubmissionService
    private weak var appState: AppState?

    // MARK: - Inputs

    public var selectedRecipient: Recipient?
    public let amountStore: AmountStore

    // MARK: - Submission state

    public private(set) var lastError: SendError?
    /// Sticky output. Read via `consumeLastCreated()` so re-entrant
    /// renders don't re-route navigation. (C6)
    private var pendingCreatedTransfer: Transfer?

    // MARK: - Init

    public init(
        api: AuthAPI,
        appState: AppState? = nil,
        amountStore: AmountStore = AmountStore(),
        rateService: RateQuoteService? = nil,
        submitter: TransferSubmissionService? = nil
    ) {
        self.appState = appState
        self.amountStore = amountStore
        self.rateService = rateService ?? RateQuoteService(api: api)
        self.submitter = submitter ?? TransferSubmissionService(api: api, appState: appState)
    }

    // MARK: - Re-binding (legacy)

    /// Re-bind the AppState after construction. Iter-1 SendView used
    /// this for environment plumbing; iter-2 prefers passing AppState
    /// at init time but the method is retained so the existing
    /// SendView call-site continues to compile.
    public func bind(appState: AppState) {
        self.appState = appState
        submitter.attach(appState: appState)
    }

    // MARK: - Rate-derived state (proxied through the service)

    public var corridorId: String? { rateService.quote?.corridorId }
    public var customerRate: Decimal? { rateService.quote?.customerRate }
    public var rateEffectiveAt: Date? { rateService.quote?.effectiveAt }
    public var isLoadingRateInFlight: Bool { rateService.isLoadingRate }
    /// Back-compat shim retained until callers migrate to the
    /// `is<Verb>InFlight` naming (W11). New code should read
    /// `isLoadingRateInFlight`.
    public var isLoadingRate: Bool { isLoadingRateInFlight }

    public var rateAge: TimeInterval? {
        guard let at = rateEffectiveAt else { return nil }
        return Date().timeIntervalSince(at)
    }

    /// Retained for back-compat — the canonical threshold lives on
    /// `RateQuoteService`. Both surfaces return the same value.
    public static let staleThreshold: TimeInterval = RateQuoteService.staleThreshold

    public var isRateStale: Bool {
        !rateService.isFresh()
    }

    public var isSubmittingTransfer: Bool { submitter.isSubmittingTransfer }

    /// NGN preview for the amount field. nil when either side of the
    /// product is unknown.
    public var ngnPreview: Decimal? {
        guard let rate = customerRate else { return nil }
        let send = amountStore.decimalAmount
        guard send > 0 else { return nil }
        return send * rate
    }

    /// All preconditions for a transfer are met.
    public var canSubmit: Bool {
        submitBlocker == nil
    }

    public var submitBlocker: SendSubmitBlocker? {
        guard !isSubmittingTransfer else { return .submitting }
        guard selectedRecipient != nil else { return .missingRecipient }
        guard rateService.quote != nil else { return .missingRate }
        guard amountStore.cents > 0 else { return .emptyAmount }
        return nil
    }

    // MARK: - Rate loading

    public func loadRate(base: String = "AUD", target: String = "NGN") async {
        let result = await rateService.loadRate(base: base, target: target)
        switch result {
        case .success:
            if lastError == .rateStale || lastError == .rateLoadFailed {
                lastError = nil
            }
        case .failure:
            lastError = .rateLoadFailed
        }
    }

    // MARK: - Transfer submission

    /// End-to-end: create transfer after the user completes the
    /// deliberate slide confirmation. Face ID belongs to app unlock,
    /// not the money-transfer submit path.
    public func confirmAndSubmit() async {
        guard canSubmit else { return }
        guard let recipient = selectedRecipient else { return }
        guard let quote = rateService.quote else { return }

        let result = await submitter.submit(
            recipientId: recipient.id,
            rateQuote: quote,
            sendAmount: amountStore.decimalAmount
        )
        apply(result)
    }

    /// Consumes the sticky pending transfer. SendView calls this from
    /// the `onTransferCreated` callback wired by `SendTabRoot`; once
    /// returned, the slot is cleared so a re-render can't re-route.
    public func consumeLastCreated() -> Transfer? {
        let t = pendingCreatedTransfer
        pendingCreatedTransfer = nil
        return t
    }

    // MARK: - Result handling

    private func apply(_ result: TransferSubmissionResult) {
        switch result {
        case .success(let transfer):
            pendingCreatedTransfer = transfer
            lastError = nil
        case .refusedAlreadyInFlight:
            // No-op; either we're already submitting or there's a
            // live transfer in-flight. Don't overwrite an existing
            // banner.
            break
        case .sessionExpired:
            lastError = .sessionExpired
        case .failed(let err):
            lastError = Self.mapAPIError(err)
        }
    }

    // MARK: - Helpers

    /// Wire-format helper. Retained as a static for any callers that
    /// still need direct access; the submission service uses
    /// `Decimal.wireString` directly so this is non-load-bearing.
    static func format(_ d: Decimal) -> String {
        d.wireString
    }

    /// Typed APIError → SendError dispatch. NO substring matching —
    /// the typed-reason enum cases (C4) are the source of truth.
    static func mapAPIError(_ err: APIError) -> SendError {
        switch err {
        case .kycRequired:               return .kycBlocked
        case .rateExpired:               return .rateStale
        case .recipientNotOwned:         return .recipientNotOwned
        case .dailyLimitExceeded:        return .dailyLimitExceeded
        case .amountOutOfRange:          return .amountOutOfRange
        case .invalidCorridor:           return .invalidCorridor
        case .emailUnverified:           return .emailUnverified
        case .idempotencyKeyConflict:    return .idempotencyKeyConflict
        case .unauthorized:              return .sessionExpired
        case .forbidden:                 return .kycBlocked  // safe default for unknown 403
        case .rateLimited:               return .unknown("Too many requests. Try again in a moment.")
        case .validation:                return .amountOutOfRange
        case .transport(let msg):        return .transport(SendErrorSanitizer.sanitize(msg))
        case .server(_, let msg):
            return .unknown(SendErrorSanitizer.sanitize(msg ?? "Something went wrong. Please try again."))
        default:
            return .unknown(err.errorDescription ?? "Could not submit transfer.")
        }
    }
}

// MARK: - Banner sanitiser (C4)
//
// Defence in depth: redact any cuid_… identifier that may slip into a
// server message before the banner renders it. Server-side audit fix
// stops this at the source, but the client banner should never echo
// internal ids back at the user regardless.
enum SendErrorSanitizer {
    private static let cuidPattern: NSRegularExpression? = {
        // Matches cuid v2 (lowercase alnum, length 24-32) and cuid1
        // (c + lowercase alnum, length 24+). Conservative: only strip
        // identifiers that look like internal handles, not arbitrary
        // user text.
        let pattern = "c[a-z0-9]{20,40}"
        return try? NSRegularExpression(pattern: pattern, options: [])
    }()

    static func sanitize(_ msg: String) -> String {
        guard let re = cuidPattern else { return msg }
        let range = NSRange(msg.startIndex..., in: msg)
        return re.stringByReplacingMatches(in: msg, options: [], range: range, withTemplate: "[id]")
    }
}
