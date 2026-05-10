// ReferralCapture.swift  (Phase 1 · U91)
// Captures a WhatsApp-shared referral token via three paths, in increasing
// precedence order:
//   1. Pasteboard scan on first launch (one-shot per install)
//   2. Universal-link arrival (`/refer/<token>`)
//   3. Explicit prompt on Welcome screen
//
// Higher-precedence sources overwrite lower-precedence stored tokens.
// A successful `consume()` clears the keychain entry once the token has
// been attached to a register/first-send call.

import Foundation

/// Test seam for `UIPasteboard`. Implementations are isolated as actors so the
/// service stays Sendable under -strict-concurrency=complete.
public protocol PasteboardSource: Sendable {
    /// Current pasteboard string, or nil if empty/unavailable.
    func currentString() async -> String?
}

#if canImport(UIKit)
import UIKit

/// Production pasteboard source backed by `UIPasteboard.general`. Reading the
/// pasteboard from a fresh install triggers iOS's "Pasted from <app>" toast,
/// which is exactly the intended UX for warm-arrival referrals.
public struct SystemPasteboard: PasteboardSource {
    public init() {}
    public func currentString() async -> String? {
        await MainActor.run { UIPasteboard.general.string }
    }
}
#else
/// Non-iOS fallback (test host on macOS). Always nil.
public struct SystemPasteboard: PasteboardSource {
    public init() {}
    public func currentString() async -> String? { nil }
}
#endif

/// Service that owns capture / persistence / consumption of the referral token.
/// Inject via `@Environment(\.referralCapture)` once wired in the app root.
///
/// Concurrency: declared `final class @unchecked Sendable`. The class holds only
/// references to thread-safe primitives (UserDefaults' set/bool API, the
/// `Keychain` actor, and a Sendable PasteboardSource), so no internal locking
/// is needed. Async methods exist because `PasteboardSource` and `Keychain` are
/// async; nothing about this class itself requires actor isolation.
public final class ReferralCapture: @unchecked Sendable {

    // MARK: - Token format
    //
    // `kola_<base32-12chars>` where the suffix is 12 lowercase alphanumerics.
    // Validation also accepts the token in any case + surrounding whitespace
    // so explicit-prompt input "feels right" — see `normalize(_:)`.

    // Regex<Substring> isn't Sendable, but this instance is immutable and
    // pattern-matching is read-only / thread-safe in practice.
    nonisolated(unsafe) private static let tokenRegex = #/^kola_[a-z0-9]{12}$/#

    // MARK: - Pasteboard one-shot guard

    private static let kPasteboardScannedFlag = "kola.referralPasteboardScanned"

    private let keychain: Keychain
    private let defaults: UserDefaults
    private let pasteboard: PasteboardSource

    public init(keychain: Keychain,
                defaults: UserDefaults = .standard,
                pasteboard: PasteboardSource = SystemPasteboard()) {
        self.keychain = keychain
        self.defaults = defaults
        self.pasteboard = pasteboard
    }

    // MARK: - Public API

    /// Inspect the system pasteboard exactly once per install. Returns the
    /// stored token on success, or nil if already-consumed / empty / invalid.
    /// Sets the one-shot flag whether or not a valid token was found.
    @discardableResult
    public func captureFromPasteboardIfNotConsumed() async -> String? {
        guard !defaults.bool(forKey: Self.kPasteboardScannedFlag) else { return nil }
        defaults.set(true, forKey: Self.kPasteboardScannedFlag)

        guard let raw = await pasteboard.currentString(),
              let token = Self.normalize(raw) else { return nil }

        await store(token)
        return token
    }

    /// Handle a `https://kolaleaf.com.au/refer/<token>` universal link.
    /// Overrides any pasteboard-sourced token already stored.
    @discardableResult
    public func captureFromUniversalLink(_ url: URL) async -> String? {
        let path = url.path
        guard path.hasPrefix("/refer/") else { return nil }
        let raw = String(path.dropFirst("/refer/".count))
        guard let token = Self.normalize(raw) else { return nil }
        await store(token)
        return token
    }

    /// Handle a token entered via the explicit "Got an invite?" prompt on
    /// Welcome. Highest precedence — overrides everything else.
    @discardableResult
    public func captureFromExplicit(_ raw: String) async -> String? {
        guard let token = Self.normalize(raw) else { return nil }
        await store(token)
        return token
    }

    /// Read the currently-stored token, if any.
    public func currentToken() async -> String? {
        try? await keychain.loadString(forKey: KeychainKeys.referralToken)
    }

    /// Mark the token as applied. Called once the backend has accepted the
    /// register / first-send call that carried this token.
    public func consume() async {
        try? await keychain.delete(forKey: KeychainKeys.referralToken)
    }

    // MARK: - Private

    private func store(_ token: String) async {
        try? await keychain.saveString(token, forKey: KeychainKeys.referralToken)
    }

    /// Trim, lowercase, regex-validate. Returns the canonical token or nil.
    private static func normalize(_ raw: String) -> String? {
        let candidate = raw
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        guard (try? tokenRegex.wholeMatch(in: candidate)) != nil else { return nil }
        return candidate
    }
}
