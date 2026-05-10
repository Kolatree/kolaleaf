// SumsubResult.swift  (Phase 2 · U24c)
// Outcome the Sumsub presenter (native SDK or WKWebView fallback) reports
// back when its sheet dismisses. The backend webhook is the source of truth
// for `kycStatus`; this enum drives only iOS-side optimistic state and
// routing.

import Foundation

/// Discriminated outcome of a Sumsub session.
///
/// Sumsub WebSDK posts these terminal events through `window.postMessage`
/// (mapped via `WKScriptMessageHandler` in `SumsubWebViewController`) and the
/// native SDK reports the same via its result callback. The bridge collapses
/// SDK-specific payloads into this enum so iOS view-models and `AppState`
/// don't need to know which provider ran.
public enum SumsubResult: Equatable, Sendable {
    /// Applicant submitted all required documents — Sumsub will run
    /// asynchronous review. iOS optimistically sets `kycStatus = .inReview`
    /// and routes to the polling screen (U25).
    case submitted

    /// Sumsub returned a terminal verdict before iOS dismissed the sheet.
    /// `answer` mirrors Sumsub's `reviewAnswer` ("GREEN" / "RED"). iOS only
    /// uses this to short-circuit polling — backend webhook is authoritative.
    case verdict(answer: String)

    /// User dismissed the Sumsub view without finishing. Status stays at
    /// whatever the backend last reported (typically `pending`).
    case cancelled

    /// SDK / web SDK error (token expired, network drop inside the sheet,
    /// device unsupported). `code` is the SDK's machine code; `message` is
    /// surfaced to the user.
    case failed(code: String, message: String)
}
