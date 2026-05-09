// Keychain.swift  (Phase 0 · U13)
// Thin actor wrapper around Security framework Keychain APIs.
//
// Partition rule (per r2 security review):
//   • SESSION TOKEN  → app-private keychain (no kSecAttrAccessGroup). Widget cannot read.
//   • TRANSFER STATE → shared via App Group only (key: `liveActivityState.<id>`).
//
// Use the `.appPrivate` access option for any auth/session credential.
// Use `.appGroup` only for non-credential data the widget legitimately needs.

import Foundation
import Security

public enum KeychainAccessGroup: Sendable {
    case appPrivate
    case appGroup(String) // e.g., "group.com.kolaleaf.shared"
}

public enum KeychainError: Error, Equatable, Sendable {
    case duplicate
    case notFound
    case unexpectedStatus(OSStatus)
    case invalidData
}

public actor Keychain {
    private let service: String
    private let group: KeychainAccessGroup

    /// Default service identifier; matches the bundle ID for the main app.
    public init(service: String = "com.kolaleaf.app", group: KeychainAccessGroup = .appPrivate) {
        self.service = service
        self.group = group
    }

    // MARK: - Public

    public func save(_ data: Data, forKey key: String) throws {
        var query = baseQuery(for: key)
        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

        let status = SecItemAdd(query as CFDictionary, nil)
        switch status {
        case errSecSuccess:
            return
        case errSecDuplicateItem:
            try update(data, forKey: key)
        default:
            throw KeychainError.unexpectedStatus(status)
        }
    }

    public func load(forKey key: String) throws -> Data {
        var query = baseQuery(for: key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        switch status {
        case errSecSuccess:
            guard let data = item as? Data else { throw KeychainError.invalidData }
            return data
        case errSecItemNotFound:
            throw KeychainError.notFound
        default:
            throw KeychainError.unexpectedStatus(status)
        }
    }

    public func delete(forKey key: String) throws {
        let query = baseQuery(for: key)
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.unexpectedStatus(status)
        }
    }

    // MARK: - String helpers

    public func saveString(_ value: String, forKey key: String) throws {
        guard let data = value.data(using: .utf8) else { throw KeychainError.invalidData }
        try save(data, forKey: key)
    }

    public func loadString(forKey key: String) throws -> String {
        let data = try load(forKey: key)
        guard let s = String(data: data, encoding: .utf8) else { throw KeychainError.invalidData }
        return s
    }

    // MARK: - Private

    private func update(_ data: Data, forKey key: String) throws {
        let query = baseQuery(for: key)
        let attributes: [String: Any] = [kSecValueData as String: data]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        guard status == errSecSuccess else { throw KeychainError.unexpectedStatus(status) }
    }

    private func baseQuery(for key: String) -> [String: Any] {
        var q: [String: Any] = [
            kSecClass as String:       kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        if case let .appGroup(name) = group {
            q[kSecAttrAccessGroup as String] = name
        }
        return q
    }
}

// MARK: - Well-known keys

public enum KeychainKeys {
    /// Mirror of the auth session cookie value, app-private. Used for:
    ///   - Re-auth detection on cold launch (cookie may survive in HTTPCookieStorage but
    ///     having a separate marker lets us detect partial corruption / migration).
    ///   - Force-logout: clearing this key on idle-timeout supersedes any in-memory state.
    public static let sessionToken = "session.token"

    /// User ID (so the app can show "logged in as ___" before a /me round-trip on cold launch).
    public static let currentUserId = "session.userId"

    /// Captured referral code from a warm-arrival universal link or clipboard (U91).
    /// Persisted until first successful send, then cleared.
    public static let pendingReferralCode = "referral.pendingCode"

    /// App Attest key ID (U76d). Per-device, generated once, used for every assertion.
    /// Not the assertion itself — that's request-scoped.
    public static let appAttestKeyId = "attest.keyId"
}
