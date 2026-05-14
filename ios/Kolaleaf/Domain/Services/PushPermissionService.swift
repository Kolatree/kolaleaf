// PushPermissionService.swift  (Phase 2 · U28)
// Lazy APNs permission request + token registration.
//
// Permission is requested only when iOS reaches a screen that meaningfully
// benefits from notifications — the first KYC under-review surface today,
// transfer-in-flight + 2FA-enable later. This avoids the "first launch ->
// blanket permission prompt" anti-pattern that lowers grant rates.
//
// Backend route POST /api/v1/account/push-tokens is a follow-up; the iOS
// surface is wired so when the route lands, `register(deviceToken:)`
// becomes useful without code changes.

import Foundation
import UserNotifications

/// Sendable mirror of `UNAuthorizationStatus`. Lets PushPermissionService be
/// a pure actor without leaking Foundation reference types across boundaries
/// under `-strict-concurrency=complete`.
public enum PushAuthorizationStatus: Sendable, Equatable {
    case notDetermined
    case denied
    case authorized
    case provisional
    case ephemeral
}

public enum NotificationPreferenceKeys {
    public static let newDeviceAlerts = "kola.notifications.newDeviceAlerts"
    public static let transferPushAlerts = "kola.notifications.transferPushAlerts"

    public static func newDeviceAlertsEnabled(defaults: UserDefaults = .standard) -> Bool {
        defaults.object(forKey: newDeviceAlerts) as? Bool ?? true
    }

    public static func transferPushAlertsEnabled(defaults: UserDefaults = .standard) -> Bool {
        defaults.object(forKey: transferPushAlerts) as? Bool ?? true
    }
}

/// Surface PushPermissionService consumes — tests substitute a fake.
/// `UNUserNotificationCenter` is a non-Sendable singleton, so we wrap it in
/// `SystemUserNotificationCenter` rather than conforming it directly.
public protocol UserNotificationCenterAPI: Sendable {
    func requestAuthorization(options: UNAuthorizationOptions) async throws -> Bool
    func currentAuthorizationStatus() async -> PushAuthorizationStatus
}

/// Production wrapper. The wrapper is value-typed and safe under strict
/// concurrency; each call hops to the system center on its own.
public struct SystemUserNotificationCenter: UserNotificationCenterAPI {
    public init() {}

    public func requestAuthorization(options: UNAuthorizationOptions) async throws -> Bool {
        try await UNUserNotificationCenter.current().requestAuthorization(options: options)
    }

    public func currentAuthorizationStatus() async -> PushAuthorizationStatus {
        let raw = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        switch raw {
        case .authorized:    return .authorized
        case .denied:        return .denied
        case .notDetermined: return .notDetermined
        case .provisional:   return .provisional
        case .ephemeral:     return .ephemeral
        @unknown default:    return .denied
        }
    }
}

public actor PushPermissionService {

    public enum PromptOutcome: Equatable, Sendable {
        case granted
        case denied
        case alreadyDetermined(authorized: Bool)
        case error(String)
    }

    /// API-2003 (Phase 10B iter-2): kept as a typealias-style wrapper
    /// over the canonical `PushTokenKind` so existing call sites
    /// (`register(deviceToken:kind: .notification)`) keep working
    /// without churn while the wire payload uses the typed enum.
    public enum TokenKind: Sendable {
        case notification
        case liveActivity

        var wire: PushTokenKind {
            switch self {
            case .notification: return .notification
            case .liveActivity: return .liveActivity
            }
        }
    }

    private let api: AuthAPI
    private let center: UserNotificationCenterAPI
    private let bundleId: String
    private let device: String?

    public init(
        api: AuthAPI,
        center: UserNotificationCenterAPI = SystemUserNotificationCenter(),
        bundleId: String = Bundle.main.bundleIdentifier ?? "com.kolaleaf.app",
        device: String? = nil
    ) {
        self.api = api
        self.center = center
        self.bundleId = bundleId
        self.device = device
    }

    /// Requests permission if the user hasn't decided yet; otherwise returns
    /// the current authorization state. Caller handles the UI fallback when
    /// authorization is denied (in-app explainer screen).
    public func promptIfNeeded() async -> PromptOutcome {
        guard NotificationPreferenceKeys.transferPushAlertsEnabled() else {
            return .alreadyDetermined(authorized: false)
        }
        let status = await center.currentAuthorizationStatus()
        switch status {
        case .authorized, .provisional, .ephemeral:
            return .alreadyDetermined(authorized: true)
        case .denied:
            return .alreadyDetermined(authorized: false)
        case .notDetermined:
            do {
                let granted = try await center.requestAuthorization(options: [.alert, .badge, .sound])
                return granted ? .granted : .denied
            } catch {
                return .error(error.localizedDescription)
            }
        }
    }

    /// Registers a hex-encoded APNs device token with the backend. Called
    /// from the AppDelegate's `application(_:didRegisterForRemoteNotifications:)`
    /// hook (or its SwiftUI lifecycle equivalent). Idempotent — backend
    /// dedupes by `(userId, deviceToken)`.
    @discardableResult
    public func register(deviceToken: Data, kind: TokenKind = .notification) async -> Result<Void, APIError> {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        let req = RegisterPushTokenRequest(
            deviceToken: hex,
            kind: kind.wire,
            bundleId: bundleId,
            device: device
        )
        // CA-2004 / API-2006 / ADV-P10B-W7 (Phase 10C iter-1): push-
        // token registration is background plumbing — pass `.system`
        // explicitly so the 2xx success doesn't reset the user-touch
        // idle clock.
        let result = await api.send(PushTokenEndpoints.Register(req), origin: .system)
        return result.map { _ in () }
    }
}
