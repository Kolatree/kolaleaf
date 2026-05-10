// PushNotificationDelegate.swift  (Phase 2 · U28)
// Bridges the iOS application lifecycle hooks needed for APNs token
// delivery into the SwiftUI app graph. Without this, the user can grant
// notification permission via PushPermissionService.promptIfNeeded() but
// `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)`
// never fires, so PushPermissionService.register(deviceToken:) is dead
// code (Phase 2 review fix · adversarial adv-003 / agent-native warning).
//
// Wiring: KolaleafApp installs this via @UIApplicationDelegateAdaptor
// and calls `bind(_:)` once with the live PushPermissionService instance
// at scene start. After permission is granted, callers invoke
// `UIApplication.shared.registerForRemoteNotifications()` and the system
// drives the delegate hooks below; the token is forwarded to the bound
// service which posts to /api/v1/account/push-tokens.

import UIKit

public final class PushNotificationDelegate: NSObject, UIApplicationDelegate {

    /// Set once at app launch by KolaleafApp.
    private static var pushPermissionService: PushPermissionService?

    /// Binds the production PushPermissionService. Idempotent — last write
    /// wins, which is fine because the app only constructs one instance.
    @MainActor
    public static func bind(_ service: PushPermissionService) {
        pushPermissionService = service
    }

    public func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        guard let service = Self.pushPermissionService else { return }
        Task {
            _ = await service.register(deviceToken: deviceToken, kind: .notification)
        }
    }

    public func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        // Swallow silently — APNs registration failure is not user-facing
        // (most often "no entitlement in dev build" or "running on the
        // simulator"). The next launch will retry.
    }
}
