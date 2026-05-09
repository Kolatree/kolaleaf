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

import SwiftUI
import UIKit

/// Marker that opts a screen into the switcher-blur overlay. Apply on the root container of
/// any screen showing transfer amounts, recipient names, PayID, BSB/account, or backup codes.
public struct SwitcherBlurMarker: ViewModifier {
    public func body(content: Content) -> some View {
        content
            .background(SwitcherBlurMarkerProbe())
    }
}

public extension View {
    /// Marks this screen as financial-sensitive. The app installs a global blur overlay
    /// when scene deactivates while a marked screen is on top.
    func sensitiveScreen() -> some View { modifier(SwitcherBlurMarker()) }
}

// MARK: - Internal: probe + window-level overlay

private struct SwitcherBlurMarkerProbe: UIViewRepresentable {
    func makeUIView(context: Context) -> UIView {
        let v = UIView()
        v.isHidden = true
        SwitcherBlurController.shared.markerCount += 1
        return v
    }

    func updateUIView(_ uiView: UIView, context: Context) {}

    static func dismantleUIView(_ uiView: UIView, coordinator: ()) {
        SwitcherBlurController.shared.markerCount = max(0, SwitcherBlurController.shared.markerCount - 1)
    }
}

@MainActor
final class SwitcherBlurController {
    static let shared = SwitcherBlurController()

    /// Reference count of currently-mounted sensitive screens. The blur fires only when
    /// at least one is on top; non-sensitive screens (Welcome, Help, About) are skipped.
    var markerCount: Int = 0

    private weak var overlayView: UIView?

    private init() {
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(willDeactivate),
                       name: UIScene.willDeactivateNotification, object: nil)
        nc.addObserver(self, selector: #selector(didActivate),
                       name: UIScene.didActivateNotification, object: nil)
    }

    @objc private func willDeactivate() {
        guard markerCount > 0, overlayView == nil else { return }
        guard let window = keyWindow() else { return }

        let overlay = makeOverlay(frame: window.bounds)
        window.addSubview(overlay)
        overlayView = overlay
    }

    @objc private func didActivate() {
        overlayView?.removeFromSuperview()
        overlayView = nil
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

        // Gradient sublayer mirroring the Variant C wallpaper (without overhead of SwiftUI render).
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
