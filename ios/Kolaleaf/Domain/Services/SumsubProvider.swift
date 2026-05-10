// SumsubProvider.swift  (Phase 2 · U24a)
// Protocol abstraction over the two Sumsub presentation strategies:
//   • Native `IdensicMobileSDK` (gated on KOLA_SUMSUB_NATIVE_SDK feature flag,
//     default OFF at v1 ship — SDK package is added at signing time, not now)
//   • WKWebView fallback (R16 spec — nonPersistent data store, JS bridge,
//     camera permission delegate, file-protection complete)
//
// The presenter (U24c) selects a provider based on availability + flag and
// hands it a `KYCSession`; the provider asynchronously yields a
// `SumsubResult`. Tests substitute a fake provider — no real WKWebView /
// SDK invocation in unit-test land.

import Foundation

/// Yields a SumsubResult for a given session. Implementations:
///   • `SumsubWebViewProvider` — UIViewControllerRepresentable wrapping
///     WKWebView with `WKWebsiteDataStore.nonPersistent()`.
///   • `SumsubNativeProvider` — UIViewControllerRepresentable wrapping
///     IdensicMobileSDK once the SwiftPM package is added (post-signing).
///   • `FakeSumsubProvider` (tests) — returns a staged result.
public protocol SumsubProvider: Sendable {
    /// Presents the Sumsub flow for `session` and resumes when the user
    /// finishes / cancels / errors. The implementation owns its own UI host
    /// (sheet, full-screen cover, etc.) and dismisses before resuming.
    func present(session: KYCSession) async -> SumsubResult
}
