// SwitcherBlur.swift  (Phase 0 · U7b1 + U7b2)
// Security primitive: blur sensitive screens in the iOS app switcher.
//
// iOS captures a snapshot of the last-rendered frame when the app is backgrounded.
// On financial screens we replace that frame with a branded blur so amounts, recipient
// names, PayID, and backup codes never leak in the multitasking UI.
//
// Implementation note (per security-lens R2 finding): we use `UIScene.willDeactivateNotification`
// rather than `applicationDidEnterBackground` because iOS captures the snapshot during
// scene deactivation. The overlay is inserted into the key window's view hierarchy at
// the highest z-index and removed on `didActivateNotification`.
//
// Scope: this modifier covers only the main-app-process surfaces. The Live Activity in
// the lock screen and Dynamic Island are SpringBoard-rendered; their redaction lives in
// `KolaleafWidgets/LockScreenCardRedacted.swift` and `DynamicIslandExpanded.swift`
// (U7c, gated by lock state via the App Group flag).
//
// r2-review fixes · 2026-05-09:
//   • #11 (concurrency): @MainActor isolation on the controller eliminates the strict-
//     concurrency error from non-isolated UIViewRepresentable lifecycle methods touching
//     shared state.
//   • #4 (security/correctness): Marker tracking moved to a Set<UUID> keyed by per-screen
//     identity, removing the ref-count drift that could leave the count positive (blur
//     stuck on Welcome) or negative (no blur on Send). SwiftUI .onAppear/.onDisappear
//     replaces UIViewRepresentable lifecycle which had no removal guarantee.

import SwiftUI
import UIKit

/// Marker that opts a screen into the switcher-blur overlay. Apply on the root container
/// of any screen showing transfer amounts, recipient names, PayID, BSB/account, or
/// backup codes.
public struct SwitcherBlurMarker: ViewModifier {
    @State private var token = UUID()

    public func body(content: Content) -> some View {
        content
            .onAppear { Task { @MainActor in SwitcherBlurController.shared.add(token) } }
            .onDisappear { Task { @MainActor in SwitcherBlurController.shared.remove(token) } }
    }
}

public extension View {
    /// Marks this screen as financial-sensitive. The app installs a global blur overlay
    /// when scene deactivates while a marked screen is on top.
    func sensitiveScreen() -> some View { modifier(SwitcherBlurMarker()) }
}

// MARK: - Internal: window-level overlay controller

@MainActor
final class SwitcherBlurController {
    static let shared = SwitcherBlurController()

    private var activeMarkers: Set<UUID> = []
    private weak var overlayView: UIView?

    private init() {
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(willDeactivate),
                       name: UIScene.willDeactivateNotification, object: nil)
        nc.addObserver(self, selector: #selector(didActivate),
                       name: UIScene.didActivateNotification, object: nil)
    }

    func add(_ token: UUID)    { activeMarkers.insert(token) }
    func remove(_ token: UUID) { activeMarkers.remove(token) }

    /// Test-only: reset state between tests so previous test's markers don't leak.
    func resetForTesting() {
        activeMarkers.removeAll()
        overlayView?.removeFromSuperview()
        overlayView = nil
    }

    @objc private func willDeactivate() {
        guard !activeMarkers.isEmpty, overlayView == nil else { return }
        guard let window = keyWindow() else { return }

        let overlay = makeOverlay(frame: window.bounds)
        // Hide everything below the overlay from accessibility tools.
        window.accessibilityElementsHidden = true
        window.addSubview(overlay)
        overlayView = overlay
    }

    @objc private func didActivate() {
        overlayView?.removeFromSuperview()
        overlayView = nil
        keyWindow()?.accessibilityElementsHidden = false
    }

    private func keyWindow() -> UIWindow? {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow }
    }

    private func makeOverlay(frame: CGRect) -> UIView {
        let host = UIView(frame: frame)
        host.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        host.backgroundColor = UIColor(red: 0x1F/255, green: 0x11/255, blue: 0x48/255, alpha: 1)
        host.accessibilityElementsHidden = true

        // Gradient sublayer mirroring the Variant C wallpaper without SwiftUI overhead.
        let gradient = CAGradientLayer()
        gradient.frame = host.bounds
        gradient.colors = [
            UIColor(red: 0x1F/255, green: 0x11/255, blue: 0x48/255, alpha: 1).cgColor,
            UIColor(red: 0x2D/255, green: 0x1B/255, blue: 0x69/255, alpha: 1).cgColor,
            UIColor(red: 0x1A/255, green: 0x6B/255, blue: 0x3C/255, alpha: 1).cgColor,
        ]
        gradient.locations = [0, 0.35, 1]
        gradient.startPoint = CGPoint(x: 0.13, y: 0.0)
        gradient.endPoint   = CGPoint(x: 0.87, y: 1.0)
        host.layer.addSublayer(gradient)

        // Centred Kolaleaf K mark
        let label = UILabel(frame: host.bounds)
        label.text = "K"
        label.textAlignment = .center
        label.font = UIFont.systemFont(ofSize: 96, weight: .black)
        label.textColor = UIColor(red: 0x7D/255, green: 0xD8/255, blue: 0x7D/255, alpha: 1)
        label.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        host.addSubview(label)

        return host
    }
}
