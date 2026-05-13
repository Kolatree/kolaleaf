// DeepLinkRouter.swift  (Phase 10A iter-2 · ADV-P10A-C1)
//
// Routes `kolaleaf://` URLs handed to the app via SwiftUI's
// `.onOpenURL`. Wired in `KolaleafApp.body`.
//
// Supported routes:
//   kolaleaf://                 → no-op (foreground the app)
//   kolaleaf://transfer/{id}    → switch to Activity tab and stash
//                                 transferId in `appState.pendingTransferDetailId`
//   https://kolaleaf.com.au/transfer/{id}
//                               → same transfer-detail routing
//   https://kolaleaf.com.au/refer/{token}
//                               → capture referral token for onboarding
//
// Anything else falls through silently. Phase 14 still owns external
// WhatsApp allowlist verification; this router owns local dispatch.

import Foundation

@MainActor
enum DeepLinkRouter {
    static func handle(
        _ url: URL,
        appState: AppState,
        referralCapture: ReferralCapture? = nil
    ) async {
        switch url.scheme?.lowercased() {
        case "kolaleaf":
            handleCustomScheme(url, appState: appState)
        case "https":
            await handleUniversalLink(url, appState: appState, referralCapture: referralCapture)
        default:
            return
        }
    }

    private static func handleCustomScheme(_ url: URL, appState: AppState) {
        // `URL.host` is the first path component for custom schemes,
        // i.e. `kolaleaf://transfer/abc123` → host == "transfer",
        // pathComponents == ["/", "abc123"].
        switch url.host {
        case "transfer":
            routeTransfer(pathComponents: url.pathComponents, appState: appState)
        case nil, "":
            // Bare `kolaleaf://` — opening the app is sufficient.
            return
        default:
            return
        }
    }

    private static func handleUniversalLink(
        _ url: URL,
        appState: AppState,
        referralCapture: ReferralCapture?
    ) async {
        guard let host = url.host?.lowercased(),
              host == "kolaleaf.com.au" || host == "www.kolaleaf.com.au" else {
            return
        }

        let components = url.pathComponents
        guard components.count >= 2 else { return }
        switch components[1] {
        case "transfer":
            routeTransfer(pathComponents: Array(components[1...]), appState: appState)
        case "refer":
            _ = await referralCapture?.captureFromUniversalLink(url)
        default:
            return
        }
    }

    private static func routeTransfer(
        pathComponents: [String],
        appState: AppState
    ) {
        // Custom-scheme pathComponents are ["/", "<id>"]; universal-link
        // components after dropping the leading "/" are ["transfer", "<id>"].
        let idParts: ArraySlice<String>
        if pathComponents.first == "/" {
            idParts = pathComponents.dropFirst()
        } else {
            idParts = pathComponents.dropFirst()
        }
        let id = idParts.joined(separator: "/")
        guard !id.isEmpty else { return }
        appState.selectedTab = .activity
        appState.pendingTransferDetailId = id
    }
}
