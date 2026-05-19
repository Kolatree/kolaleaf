import CryptoKit
import Foundation
import Security

public enum AppPasscodeVerification: Equatable, Sendable {
    case success
    case invalid
    case notConfigured
    case unavailable
}

public struct AppPasscodeService: Sendable {
    private let keychain: Keychain
    private static let version = "v1"

    public init(keychain: Keychain) {
        self.keychain = keychain
    }

    public func isConfigured() async -> Bool {
        do {
            _ = try await keychain.loadString(forKey: KeychainKeys.appUnlockPasscodeHash)
            return true
        } catch {
            return false
        }
    }

    public func setPasscode(_ passcode: String) async throws {
        let normalized = Self.normalized(passcode)
        guard Self.isValid(normalized) else { throw AppPasscodeError.invalidFormat }
        let salt = Self.randomSalt()
        let digest = Self.digest(passcode: normalized, salt: salt)
        let payload = [
            Self.version,
            salt.base64EncodedString(),
            Data(digest).base64EncodedString(),
        ].joined(separator: ":")
        try await keychain.saveString(payload, forKey: KeychainKeys.appUnlockPasscodeHash)
    }

    public func verify(_ passcode: String) async -> AppPasscodeVerification {
        let normalized = Self.normalized(passcode)
        guard Self.isValid(normalized) else { return .invalid }

        let payload: String
        do {
            payload = try await keychain.loadString(forKey: KeychainKeys.appUnlockPasscodeHash)
        } catch KeychainError.notFound {
            return .notConfigured
        } catch {
            return .unavailable
        }

        let parts = payload.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 3,
              parts[0] == Self.version,
              let salt = Data(base64Encoded: String(parts[1])),
              let expected = Data(base64Encoded: String(parts[2])) else {
            return .unavailable
        }

        let actual = Data(Self.digest(passcode: normalized, salt: salt))
        return actual == expected ? .success : .invalid
    }

    public func clear() async {
        try? await keychain.delete(forKey: KeychainKeys.appUnlockPasscodeHash)
    }

    public static func normalized(_ passcode: String) -> String {
        passcode.filter(\.isNumber).prefix(6).map(String.init).joined()
    }

    public static func isValid(_ passcode: String) -> Bool {
        passcode.count == 6 && passcode.allSatisfy(\.isNumber)
    }

    private static func randomSalt() -> Data {
        var bytes = [UInt8](repeating: 0, count: 16)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        precondition(status == errSecSuccess, "Unable to generate passcode salt")
        return Data(bytes)
    }

    private static func digest(passcode: String, salt: Data) -> SHA256Digest {
        var data = Data()
        data.append(salt)
        data.append(Data(passcode.utf8))
        return SHA256.hash(data: data)
    }
}

public enum AppPasscodeError: Error, Equatable, Sendable {
    case invalidFormat
}
