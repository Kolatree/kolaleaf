// Keychain.swift  (Phase 0 · U13)
// Thin actor wrapper around Security framework Keychain APIs.
//
// Partition rule (per r2 security review):
//   • SESSION TOKEN  → app-private keychain (no kSecAttrAccessGroup). Widget cannot read.
//   • TRANSFER STATE → shared via App Group only (key: `liveActivityState.<id>`).
//
// r2-review fix · 2026-05-09:
//   • #19: errSecInteractionNotAllowed (-25308, device locked before first unlock) is
//     now an explicit error case, distinct from .notFound. Cold-launch on a locked
//     device must NOT trigger a fake logout.
//   • Save path: prefer SecItemUpdate over delete-then-add (cross-project lesson from
//     Porizo) — race-safe and avoids token loss on transient errors.

import Foundation
import Security

public enum KeychainAccessGroup: Sendable {
    case appPrivate
    case appGroup(String) // e.g., "group.com.kolaleaf.shared"
}

public enum KeychainError: Error, Equatable, Sendable {
    case duplicate
    case notFound
    case interactionNotAllowed   // device locked, retry after unlock
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
        // Try update first (cross-project lesson from Porizo). On notFound, fall through to add.
        let updateQuery = baseQuery(for: key)
        let updateAttrs: [String: Any] = [kSecValueData as String: data]
        let updateStatus = SecItemUpdate(updateQuery as CFDictionary, updateAttrs as CFDictionary)
        switch updateStatus {
        case errSecSuccess:
            return
        case errSecItemNotFound:
            try add(data, forKey: key)
        case errSecInteractionNotAllowed:
            throw KeychainError.interactionNotAllowed
        default:
            throw KeychainError.unexpectedStatus(updateStatus)
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
        case errSecInteractionNotAllowed:
            throw KeychainError.interactionNotAllowed
        default:
            throw KeychainError.unexpectedStatus(status)
        }
    }

    public func delete(forKey key: String) throws {
        let query = baseQuery(for: key)
        let status = SecItemDelete(query as CFDictionary)
        switch status {
        case errSecSuccess, errSecItemNotFound:
            return
        case errSecInteractionNotAllowed:
            throw KeychainError.interactionNotAllowed
        default:
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

    private func add(_ data: Data, forKey key: String) throws {
        var query = baseQuery(for: key)
        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

        let status = SecItemAdd(query as CFDictionary, nil)
        switch status {
        case errSecSuccess:
            return
        case errSecDuplicateItem:
            // Lost a race with another writer. Retry as update.
            let updateQuery = baseQuery(for: key)
            let updateAttrs: [String: Any] = [kSecValueData as String: data]
            let updateStatus = SecItemUpdate(updateQuery as CFDictionary, updateAttrs as CFDictionary)
            guard updateStatus == errSecSuccess else {
                throw KeychainError.unexpectedStatus(updateStatus)
            }
        case errSecInteractionNotAllowed:
            throw KeychainError.interactionNotAllowed
        default:
            throw KeychainError.unexpectedStatus(status)
        }
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
    /// Mirror of the auth session cookie value, app-private.
    public static let sessionToken = "session.token"
    /// User ID. Survives reinstall; used to show "logged in as ___" pre-/me.
    public static let currentUserId = "session.userId"
    /// Captured referral code from a warm-arrival universal link or clipboard (U91).
    public static let pendingReferralCode = "referral.pendingCode"
    /// Active referral token captured by `ReferralCapture` (U91). Cleared on `consume()`
    /// after the token is attached to register / first send for backend attribution.
    public static let referralToken = "referral.token"
    /// App Attest key ID (U76d). Per-device, generated once.
    public static let appAttestKeyId = "attest.keyId"
}
