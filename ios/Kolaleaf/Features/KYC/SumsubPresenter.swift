// SumsubPresenter.swift  (Phase 2 · U24a + U24c)
// Selects the Sumsub strategy (native SDK or WKWebView fallback) and
// presents it as a sheet from the parent route.
//
// At v1 ship the native `IdensicMobileSDK` package is NOT yet added (gated on
// signing config + product team). The presenter therefore always selects the
// WKWebView fallback today. When the SDK lands, flipping
// `useNativeSDK` (a feature flag read from launch args / remote config) to
// true will automatically prefer the native path with no call-site changes.

import SwiftUI

public struct SumsubPresenter: View {
    public let session: KYCSession
    public let onResult: @MainActor (SumsubResult) -> Void

    /// `true` selects the native SDK once integrated; `false` (default) uses
    /// WKWebView. v1 always defaults to false; remote-config flips per-user
    /// after v1.1 SDK package addition.
    public let useNativeSDK: Bool

    public init(session: KYCSession,
                useNativeSDK: Bool = false,
                onResult: @escaping @MainActor (SumsubResult) -> Void) {
        self.session = session
        self.useNativeSDK = useNativeSDK
        self.onResult = onResult
    }

    public var body: some View {
        // Native SDK path is intentionally absent until the SwiftPM package
        // is added (post-signing). Falling through to the fallback today
        // keeps the route exercised and the contract testable end-to-end.
        SumsubWebView(session: session, onResult: onResult)
            .ignoresSafeArea(.keyboard)
            // P1 fix mirror (Phase 1 review): Sumsub captures sensitive PII
            // in real time (selfies, ID photos). Mark the screen as
            // sensitive so the app-switcher snapshot blur covers it.
            .sensitiveScreen()
    }
}
