// PushTokenSync.swift  (Phase 10B · U72)
//
// Subscribes to per-activity `Activity.pushTokenUpdates` and POSTs
// every fresh token to `POST /api/v1/account/push-tokens` with
// `kind: "live_activity"`. This is SEPARATE from the regular APNS
// notification token (handled by `PushNotificationDelegate.swift`
// + `PushPermissionService.register(deviceToken:kind: .notification)`).
//
// Live Activity tokens are per-activity, not per-device. The OS
// rotates them; ActivityKit hands a new `Data` blob to the
// `pushTokenUpdates` AsyncSequence whenever the rotation happens.
// Backend stores the latest seen token and uses it to push state
// updates that hit the lock-screen surface even if the app is suspended.
//
// Wire format: lowercase hex. NEVER use base64 or upper-case — backend
// is strict. The same encoding is used for regular APNs tokens
// (see `PushPermissionService.register(deviceToken:)`).

import ActivityKit
import Foundation
import UIKit

@MainActor
public final class PushTokenSync {

    private let api: AuthAPI
    private let bundleId: String
    private let device: String?

    /// Last token POSTed for each activity id. Suppresses re-POST when
    /// the OS hands us the same bytes twice (defensive — the AsyncSequence
    /// doesn't promise dedupe).
    private var lastPostedToken: [String: String] = [:]
    /// Tokens we observed but failed to POST (network blip, 5xx). The
    /// foreground hop retries by replaying the latest pending token.
    private var pendingResync: [String: String] = [:]

    public init(
        api: AuthAPI,
        bundleId: String = Bundle.main.bundleIdentifier ?? "com.kolaleaf.app",
        device: String? = nil
    ) {
        self.api = api
        self.bundleId = bundleId
        self.device = device
    }

    /// Subscribe to a single activity's `pushTokenUpdates` and POST
    /// every new token. The provided `tokens` AsyncSequence is the
    /// `Activity<...>.pushTokenUpdates` for that activity.
    ///
    /// This call returns once the AsyncSequence completes (the OS ends
    /// the activity) — callers spawn it inside a `Task` and don't await
    /// the return.
    public func observe<S: AsyncSequence>(
        activityId: String,
        tokens: S
    ) async where S.Element == Data {
        do {
            for try await tokenData in tokens {
                await register(activityId: activityId, tokenData: tokenData)
            }
        } catch {
            // AsyncSequence threw — log + bail. The next foreground
            // hop re-attempts via `resyncAllOnForeground()`.
            #if DEBUG
            print("[PushTokenSync] pushTokenUpdates threw: \(error)")
            #endif
        }
    }

    /// Re-POST the most recent pending token for every observed activity.
    /// Called from `KolaleafApp.scenePhase == .active` to recover from
    /// network failures that happened while the app was suspended.
    public func resyncAllOnForeground() async {
        let snapshot = pendingResync
        for (activityId, hex) in snapshot {
            await postToken(activityId: activityId, hex: hex)
        }
    }

    // TODO(ADV-P10B-C10-backend): when the user signs out, the
    // per-activity APNS tokens we registered against their session
    // should be revoked server-side so a future push to a stranded
    // token can't deliver to a different user on the same device.
    // The call belongs here so PushTokenSync owns the full token
    // lifecycle:
    //
    //     await api.send(
    //         PushTokenEndpoints.RevokeAll(kind: .liveActivity),
    //         origin: .system
    //     )
    //
    // Blocking on: backend endpoint `DELETE /api/v1/account/push-tokens
    // ?kind=live_activity`. The marker is grep-able so the iOS-side
    // wire-up lands the moment the backend ships. Until that lands,
    // `KolaleafApp.forceReauth()` calls
    // `LiveActivityService.endAllActivities()` to dismiss every
    // surface locally — the OS stops delivering pushes to ended
    // activities even if the backend still holds the token.

    // MARK: - Internals

    /// Hex-encode + POST. Idempotent on the wire (backend dedupes by
    /// `(userId, deviceToken)`).
    private func register(activityId: String, tokenData: Data) async {
        let hex = Self.hex(from: tokenData)
        guard lastPostedToken[activityId] != hex else { return }
        await postToken(activityId: activityId, hex: hex)
    }

    private func postToken(activityId: String, hex: String) async {
        let req = RegisterPushTokenRequest(
            deviceToken: hex,
            kind: .liveActivity,
            bundleId: bundleId,
            device: device
        )
        // CA-2004 / API-2006 / ADV-P10B-W7 (Phase 10C iter-1): push-
        // token registration is background plumbing — pass `.system`
        // explicitly so the 2xx success doesn't reset the user-touch
        // idle clock.
        let result = await api.send(PushTokenEndpoints.Register(req), origin: .system)
        switch result {
        case .success:
            lastPostedToken[activityId] = hex
            pendingResync.removeValue(forKey: activityId)
        case .failure:
            // Hold for retry on next foreground.
            pendingResync[activityId] = hex
        }
    }

    static func hex(from data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }
}
