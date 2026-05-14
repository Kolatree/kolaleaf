// HelpViewModel.swift  (Phase 8 · U58)
// Drives the Help / live-chat screen (Screen 29).
//
// Composition:
//   • 4 quick-help cards with static copy + URL deep-links into the
//     marketing site (`https://www.kolaleaf.com/help/<slug>`).
//   • Recent transfer (the most recent transfer from the /transfers
//     list) so the user can jump straight into TransactionDetail.
//   • Chat CTA → `https://www.kolaleaf.com/help` for v1 (no embedded
//     chat).
//
// The VM uses a `WebOpener` test seam so unit tests don't actually
// launch URLs.

import Foundation
import Observation

@MainActor
@Observable
public final class HelpViewModel {

    public struct QuickHelpCard: Equatable, Identifiable, Sendable {
        public let id: String
        public let title: String
        public let subtitle: String
        public let url: URL

        public init(id: String, title: String, subtitle: String, url: URL) {
            self.id = id
            self.title = title
            self.subtitle = subtitle
            self.url = url
        }
    }

    public enum State: Equatable {
        case idle
        case loaded(recentTransfer: TransferShape?)
        case sessionExpired
    }

    public private(set) var state: State = .idle
    public let chatCTAURL: URL = URL(string: "https://www.kolaleaf.com/help")!

    /// The 4 quick-help cards. Stable IDs so the View ForEach has a
    /// deterministic identity and tests can assert against the list
    /// without binding to copy.
    public var quickHelpCards: [QuickHelpCard] {
        [
            QuickHelpCard(
                id: "transfer-status",
                title: String(
                    localized: "help.card.transfer_status.title",
                    defaultValue: "Where's my transfer?"
                ),
                subtitle: String(
                    localized: "help.card.transfer_status.subtitle",
                    defaultValue: "Track a transfer, refund or delay."
                ),
                url: URL(string: "https://www.kolaleaf.com/help/transfer-status")!
            ),
            QuickHelpCard(
                id: "limits-fees",
                title: String(
                    localized: "help.card.limits_fees.title",
                    defaultValue: "Limits and fees"
                ),
                subtitle: String(
                    localized: "help.card.limits_fees.subtitle",
                    defaultValue: "Daily limits, FX rates and service fees."
                ),
                url: URL(string: "https://www.kolaleaf.com/help/limits-fees")!
            ),
            QuickHelpCard(
                id: "kyc",
                title: String(
                    localized: "help.card.kyc.title",
                    defaultValue: "Identity verification"
                ),
                subtitle: String(
                    localized: "help.card.kyc.subtitle",
                    defaultValue: "Why we ask and what to upload."
                ),
                url: URL(string: "https://www.kolaleaf.com/help/kyc")!
            ),
            QuickHelpCard(
                id: "security",
                title: String(
                    localized: "help.card.security.title",
                    defaultValue: "Account security"
                ),
                subtitle: String(
                    localized: "help.card.security.subtitle",
                    defaultValue: "2FA, sign-in alerts and recovery."
                ),
                url: URL(string: "https://www.kolaleaf.com/help/security")!
            ),
        ]
    }

    private let api: AuthAPI
    private let opener: WebOpener

    public init(api: AuthAPI, opener: WebOpener = SystemBrowserOpener()) {
        self.api = api
        self.opener = opener
    }

    /// Pulls the most recent transfer from /transfers (limit=1) so
    /// the "Recent transfer" deep-link can carry the id. Network
    /// failures degrade gracefully — the section just hides.
    public func load() async {
        let result = await api.send(TransfersEndpoints.List(
            status: nil, limit: 1, cursor: nil
        ))
        switch result {
        case .success(let response):
            state = .loaded(recentTransfer: response.transfers.first)
        case .failure(let err):
            if case .unauthorized = err {
                state = .sessionExpired
            } else {
                state = .loaded(recentTransfer: nil)
            }
        }
    }

    public func openQuickHelp(_ card: QuickHelpCard) {
        opener.open(card.url)
    }

    public func openChatCTA() {
        opener.open(chatCTAURL)
    }

    /// Iter-2 (N19): named as a getter, not a verb — it reads state
    /// (the most recent transfer's id) and does NOT perform side
    /// effects. Iter-1's `openRecentTransfer()` implied a navigation
    /// action it never actually triggered.
    public var recentTransferId: String? {
        guard case .loaded(let recent) = state, let recent else { return nil }
        return recent.id
    }
}

// MARK: - WebOpener (test seam)

/// Narrow protocol so VM tests can assert which URL was opened
/// without actually launching Safari.
public protocol WebOpener: Sendable {
    func open(_ url: URL)
}

/// Production opener — uses `UIApplication.shared.open(_:)` which
/// honours an in-app browser if installed. SFSafariViewController is
/// out of scope for v1; this opens the system default browser, hence
/// the iter-2 (N4) rename from the misleading `SafariWebOpener`.
public final class SystemBrowserOpener: WebOpener {
    public init() {}
    public func open(_ url: URL) {
        Task { @MainActor in
            #if canImport(UIKit)
            UIApplication.shared.open(url)
            #endif
        }
    }
}

#if canImport(UIKit)
import UIKit
#endif
