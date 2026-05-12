// ReferViewModel.swift  (Phase 8 · U57)
// Drives the Refer-a-friend screen (Screen 28).
//
// TODO(backend): `MeResponse` does NOT currently carry a `referralCode`
// or `referCode` field. iOS surfaces a "—" placeholder until the
// backend ships the field. The screen still renders so the design
// review can proceed; we'll wire the live code in a follow-up.
//
// TODO(backend): no `/account/refer-stats` endpoint exists. Stats
// default to zeros (earned/joined/pending = 0). When the endpoint
// lands, swap the hardcoded defaults for a real fetch.
//
// Copy-to-clipboard happens in the View layer (matches the pattern
// in MyPayIDView + PayIDInstructionsView — `UIPasteboard.general.setItems`
// inline). The VM owns the code string + share text only.

import Foundation
import Observation

@MainActor
@Observable
public final class ReferViewModel {

    public struct Stats: Equatable, Sendable {
        public let earned: Int
        public let joined: Int
        public let pending: Int

        public init(earned: Int, joined: Int, pending: Int) {
            self.earned = earned
            self.joined = joined
            self.pending = pending
        }

        public static let empty = Stats(earned: 0, joined: 0, pending: 0)
    }

    public enum State: Equatable {
        case idle
        case loading
        case loaded(code: String?, stats: Stats)
        case sessionExpired
        case failed(String)
    }

    public private(set) var state: State = .idle

    private let api: AuthAPI

    public init(api: AuthAPI) {
        self.api = api
    }

    /// Fetch /account/me and extract the (currently-absent) referral
    /// code. Stats default to empty until the backend ships the
    /// dedicated endpoint.
    public func load() async {
        state = .loading
        let result = await api.send(AccountEndpoints.Me())
        switch result {
        case .success:
            // TODO(backend): pull a real code off `MeResponse` when
            // backend adds the field. For now the screen renders the
            // dash placeholder.
            state = .loaded(code: nil, stats: .empty)
        case .failure(let err):
            switch err {
            case .unauthorized:
                state = .sessionExpired
            default:
                state = .failed(err.errorDescription
                                ?? "Couldn't load your referral code.")
            }
        }
    }

    /// The referral code in current state, if any.
    public var code: String? {
        if case .loaded(let code, _) = state { return code }
        return nil
    }

    /// Stats in current state — defaults to .empty when not loaded.
    public var stats: Stats {
        if case .loaded(_, let stats) = state { return stats }
        return .empty
    }

    /// Share text injected into WhatsApp / share sheet. Wraps the code
    /// with an invitation. Returns a friendly placeholder when no
    /// code is loaded so the share sheet never opens blank.
    public var shareText: String {
        let prefix = "Hey, send money to Nigeria with Kolaleaf — "
        guard let code, !code.isEmpty else {
            return prefix + "try the app and we both earn rewards."
        }
        return prefix + "use my code \(code) for $10 off your first transfer."
    }

    /// WhatsApp deep-link URL. iOS tries `whatsapp://send?text=…`
    /// first; the View falls back to the universal `https://wa.me/?…`
    /// when WhatsApp isn't installed.
    ///
    /// Iter-2 (N7 + N8): URL assembled via `URLComponents` so the text
    /// percent-encoding follows the URL standard exactly (not the
    /// looser `urlQueryAllowed` set). Gated on `code != nil` so a
    /// caller can't open a share sheet with the "try the app"
    /// placeholder copy — Refer CTAs are dark-state until a real code
    /// loads.
    public var whatsAppURL: URL? {
        guard code != nil else { return nil }
        return makeShareURL(scheme: "whatsapp", host: "send")
    }

    public var universalShareURL: URL? {
        guard code != nil else { return nil }
        return makeShareURL(scheme: "https", host: "wa.me")
    }

    private func makeShareURL(scheme: String, host: String) -> URL? {
        var components = URLComponents()
        components.scheme = scheme
        components.host = host
        components.queryItems = [URLQueryItem(name: "text", value: shareText)]
        return components.url
    }
}
