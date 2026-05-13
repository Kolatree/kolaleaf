// KolaleafTransferAttributes.swift  (Phase 10A · U66)
// ActivityKit attribute definition shared between the host app
// (drives `Activity.request(...)` from `LiveActivityService` in
// Part B) and the `KolaleafWidgets` extension (renders the lock
// screen + Dynamic Island).
//
// Membership: this file is wired into BOTH targets via
// `ios/project.yml` so the same `Codable & Sendable` types are
// addressable on either side of the IPC boundary.
//
// Why widget-local `LiveActivityState` instead of the full
// `TransferStatus`: dragging the entire Domain layer (TransferStatus
// + 14 surrounding types) through the widget compile boundary is
// wasteful and risks accidentally exposing app-only types in
// `Sendable` contexts. The user-visible bands collapse to a small set
// of states. The mapping `TransferStatus → LiveActivityState` lives
// in `LiveActivityStateMap` (app-only) wired by `LiveActivityService`
// in Part B (U71).
//
// Wire-evolution policy (iter-2 hardening · ADV-P10A-C4/C5 + API-1001):
//   • Every ContentState field decodes tolerantly. The backend MAY
//     omit any non-state field; readers MUST default sensibly.
//   • An unknown `state` rawValue decodes as `.unknown` (sentinel)
//     so a future backend band cannot brick the widget — the widget
//     renders a neutral surface and the activity stays alive.
//   • A `v` (schema version) field defaults to 1 when missing. The
//     widget does NOT refuse forward versions today; it relies on
//     per-field tolerance. A future major revision can gate on `v`
//     by mapping `v > MAX_SUPPORTED_V` to `.unknown` here.
//   • `lastUpdate` is encoded as ISO-8601 string (ADV-P10A-W6) so the
//     wire format is human-debuggable and locale-stable. Backend and
//     widget MUST agree on this strategy — see `Self.isoFormatter`.
//   • Negative `etaSeconds` clamps to 0 (ADV-P10A-W1). The widget
//     never renders a negative duration.
//   • `stageLabel` clamps to the first 48 characters (ADV-P10A-S1)
//     to bound the worst-case render width on the compact lock-screen
//     layout. Truncation happens at decode time so every consumer
//     sees the same bounded string.

import ActivityKit
import Foundation

public struct KolaleafTransferAttributes: ActivityAttributes, Sendable {

    // MARK: - Static attributes (set once at start, never mutated)

    public let transferId: String
    public let recipientName: String
    /// Currency tag for the recipient leg ("NGN" today). Future
    /// corridors swap this without touching the widget binary.
    public let recipientCurrency: String
    /// Pre-formatted send amount — the widget renders strings only.
    /// Localised once at the call site (LiveActivityService) so the
    /// extension never needs the formatter dependencies.
    public let audAmount: String
    /// Pre-formatted receive amount in the recipient currency.
    public let ngnAmount: String
    /// Pre-formatted FX rate copy ("1 AUD = 700 NGN").
    public let exchangeRate: String

    // MARK: - Dynamic content (pushed via APNS / updated locally)

    public struct ContentState: Codable, Hashable, Sendable {
        /// Schema version of this payload. Defaults to 1 when the
        /// wire payload omits it. Reserved for forward-compat gating.
        public let v: Int
        public let state: LiveActivityState
        /// Remaining seconds until the expected next state change.
        /// Clamped at decode time to `>= 0`.
        public let etaSeconds: Int
        public let lastUpdate: Date
        /// Operational copy that names the current step
        /// ("Confirming AUD…", "Paying out via Flutterwave", …).
        ///
        /// Decoded with a default of `""` when the wire payload omits
        /// it, and clamped to the first 48 characters so a verbose
        /// backend label does not wrap or push the amount column off
        /// screen. Verified by `KolaleafTransferAttributesTests`.
        public let stageLabel: String

        /// Stage-label cap applied at decode time. Public so callers
        /// (and tests) can reference the bound symbolically.
        public static let stageLabelMaxLength: Int = 48

        public init(
            state: LiveActivityState,
            etaSeconds: Int,
            lastUpdate: Date,
            stageLabel: String,
            v: Int = 1
        ) {
            self.v           = v
            self.state       = state
            self.etaSeconds  = max(0, etaSeconds)
            self.lastUpdate  = lastUpdate
            self.stageLabel  = String(stageLabel.prefix(Self.stageLabelMaxLength))
        }

        // ISO-8601 string is the single agreed-upon date format on the
        // wire. Pinning a shared formatter avoids the per-decoder
        // strategy drift we'd otherwise risk between the app and the
        // widget process. `nonisolated(unsafe)` because
        // `ISO8601DateFormatter` is not marked Sendable in Foundation;
        // we only call its thread-safe `string(from:)` / `date(from:)`
        // methods, and the configuration is set exactly once at static
        // init and never mutated.
        nonisolated(unsafe) private static let isoFormatter: ISO8601DateFormatter = {
            let f = ISO8601DateFormatter()
            f.formatOptions = [.withInternetDateTime]
            return f
        }()

        private enum CodingKeys: String, CodingKey {
            case v, state, etaSeconds, lastUpdate, stageLabel
        }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            // Schema version — default 1 when omitted. Documented above.
            self.v = (try? c.decodeIfPresent(Int.self, forKey: .v)) ?? 1
            // State — fall back to `.unknown` rather than throwing so a
            // future band the widget binary does not recognise renders
            // as a neutral "Updating…" surface instead of bricking
            // activity. ADV-P10A-C4. Legacy "failed" rawValue maps to
            // `.failedRetry` for the API-1003 split (the previous wire
            // contract used a single `failed` band).
            if let raw = try? c.decode(String.self, forKey: .state) {
                if raw == "failed" {
                    self.state = .failedRetry
                } else {
                    self.state = LiveActivityState(rawValue: raw) ?? .unknown
                }
            } else {
                self.state = .unknown
            }
            // etaSeconds — tolerant default + non-negative clamp.
            let rawEta = (try? c.decodeIfPresent(Int.self, forKey: .etaSeconds)) ?? 0
            self.etaSeconds = max(0, rawEta)
            // lastUpdate — strict ISO-8601 string. Numeric epochs are
            // rejected on purpose; the contract is documented at the
            // top of this file.
            let dateString = try c.decode(String.self, forKey: .lastUpdate)
            guard let date = Self.isoFormatter.date(from: dateString) else {
                throw DecodingError.dataCorruptedError(
                    forKey: .lastUpdate,
                    in: c,
                    debugDescription: "lastUpdate must be ISO-8601 string."
                )
            }
            self.lastUpdate = date
            // stageLabel — tolerate missing, then clamp.
            let rawLabel = (try? c.decodeIfPresent(String.self, forKey: .stageLabel)) ?? ""
            self.stageLabel = String(rawLabel.prefix(Self.stageLabelMaxLength))
        }

        public func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(v,                                        forKey: .v)
            try c.encode(state.rawValue,                           forKey: .state)
            try c.encode(etaSeconds,                               forKey: .etaSeconds)
            try c.encode(Self.isoFormatter.string(from: lastUpdate), forKey: .lastUpdate)
            try c.encode(stageLabel,                               forKey: .stageLabel)
        }
    }

    public init(
        transferId: String,
        recipientName: String,
        recipientCurrency: String,
        audAmount: String,
        ngnAmount: String,
        exchangeRate: String
    ) {
        self.transferId        = transferId
        self.recipientName     = recipientName
        self.recipientCurrency = recipientCurrency
        self.audAmount         = audAmount
        self.ngnAmount         = ngnAmount
        self.exchangeRate      = exchangeRate
    }
}

/// User-visible bands of an in-flight transfer, mirrored to the
/// widget. The full `TransferStatus` enum (in the app target) maps
/// down to one of these in `LiveActivityStateMap` (Part B).
///
/// Raw values are the on-the-wire APNS contract — snake_case to match
/// the backend's serialisation. Adding a new case is a binary-version
/// gate: shipped widget binaries decode unknown rawValues as
/// `.unknown` (see `ContentState.init(from:)`).
///
/// Backend `TransferStatus` → `LiveActivityState` (mapping table for
/// Part B's `LiveActivityStateMap`):
///
///   AWAITING_AUD                    → .awaitingAUD
///   AUD_RECEIVED, PROCESSING_NGN,   → .processingNGN
///     NGN_SENT, NGN_RETRY
///   COMPLETED                       → .completed
///   FLOAT_INSUFFICIENT              → .floatPaused
///   NGN_FAILED                      → .failedRetry
///   NEEDS_MANUAL                    → .needsAction
///   CANCELLED, EXPIRED, REFUNDED    → no Live Activity state — Part B
///                                      MUST call `Activity.end(...)`
///                                      instead of pushing a new
///                                      ContentState.
///   CREATED                         → no Live Activity yet — service
///                                      starts the activity on the
///                                      first AWAITING_AUD push.
///
/// Uniqueness: `(transferId)` is the activity identity. Part B's
/// `LiveActivityService` MUST scan `Activity.activities` and reuse if
/// one already exists for this transferId.
public enum LiveActivityState: String, Codable, Sendable, Hashable, CaseIterable {
    case awaitingAUD   = "awaiting_aud"
    case processingNGN = "processing_ngn"
    case completed     = "completed"
    case floatPaused   = "float_paused"
    /// Backend `NGN_FAILED` — payout failed, retry in flight.
    case failedRetry   = "failed_retry"
    /// Backend `NEEDS_MANUAL` — payout failed, requires user action.
    case needsAction   = "needs_action"
    /// Sentinel for forward-compat: the wire payload carried a
    /// `state` value the shipped widget binary does not know. Renders
    /// as a neutral "Updating…" surface. Never sent by the backend
    /// directly — only synthesised by the decoder.
    case unknown       = "_unknown"
}

// MARK: - Preview / snapshot fixtures
//
// Production-shipped (not `#if DEBUG`) so SwiftUI #Preview blocks
// inside the widget target can use them. They are tiny constants;
// the binary cost is trivial against the developer-experience win.

public extension KolaleafTransferAttributes {
    static let preview = KolaleafTransferAttributes(
        transferId: "tx_preview_001",
        recipientName: "Folasade",
        recipientCurrency: "NGN",
        audAmount: "$100.00 AUD",
        ngnAmount: "₦70,000 NGN",
        exchangeRate: "1 AUD = 700 NGN"
    )
}

public extension KolaleafTransferAttributes.ContentState {
    /// Build a deterministic preview state. `lastUpdate` is fixed so
    /// snapshot tests don't pick up wall-clock drift.
    static func preview(
        state: LiveActivityState,
        etaSeconds: Int,
        stageLabel: String
    ) -> KolaleafTransferAttributes.ContentState {
        KolaleafTransferAttributes.ContentState(
            state: state,
            etaSeconds: etaSeconds,
            lastUpdate: Date(timeIntervalSince1970: 1_700_000_000),
            stageLabel: stageLabel
        )
    }
}
