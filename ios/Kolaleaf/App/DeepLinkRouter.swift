// DeepLinkRouter.swift  (Phase 10A iter-2 · ADV-P10A-C1)
//
// Routes `kolaleaf://` URLs handed to the app via SwiftUI's
// `.onOpenURL`. Wired in `KolaleafApp.body`.
//
// Supported routes (Phase 10A):
//   kolaleaf://                 → no-op (foreground the app)
//   kolaleaf://transfer/{id}    → switch to Activity tab and stash
//                                 transferId in `appState.pendingTransferDetailId`
//
// Anything else falls through silently. The router is intentionally
// minimal — Phase 14 will introduce the AASA universal-link surface
// and a more complete dispatcher.

import Foundation

@MainActor
enum DeepLinkRouter {
    static func handle(_ url: URL, appState: AppState) {
        guard url.scheme == "kolaleaf" else { return }
        let host = url.host
        // `URL.host` is the first path component for custom schemes,
        // i.e. `kolaleaf://transfer/abc123` → host == "transfer",
        // pathComponents == ["/", "abc123"].
        switch host {
        case "transfer":
            // `pathComponents` is ["/", "<id>"] for a single segment.
            // Take everything after the leading "/" so a transferId
            // that survived percent-encoding (slash, question mark)
            // re-assembles via URL's own decoding.
            let id = url.pathComponents
                .dropFirst() // leading "/"
                .joined(separator: "/")
            guard !id.isEmpty else { return }
            appState.selectedTab = .activity
            appState.pendingTransferDetailId = id
        case nil, "":
            // Bare `kolaleaf://` — opening the app is sufficient.
            return
        default:
            // Future routes (recipients, account, …) land here once
            // Phase 14 expands the scheme.
            return
        }
    }
}
