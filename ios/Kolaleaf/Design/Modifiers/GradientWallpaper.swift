// GradientWallpaper.swift
// Variant C "The Send Gesture" wallpaper: 165° linear gradient (purple → green) plus two
// radial overlays. Apply with `.kolaWallpaper()` on a screen-root container.

import SwiftUI

public struct GradientWallpaper: ViewModifier {
    public func body(content: Content) -> some View {
        ZStack {
            LinearGradient(
                gradient: Gradient(stops: KolaColors.wallpaperStops),
                startPoint: UnitPoint(x: 0.13, y: 0.0),  // ≈ 165° angle direction
                endPoint:   UnitPoint(x: 0.87, y: 1.0)
            )
            .ignoresSafeArea()

            // Top-left purple bloom
            RadialGradient(
                colors: [Color(hex: 0x2D1B69, opacity: 0.45), .clear],
                center: UnitPoint(x: 0.2, y: -0.1),
                startRadius: 0,
                endRadius: 480
            )
            .blendMode(.screen)
            .ignoresSafeArea()

            // Bottom-right green bloom
            RadialGradient(
                colors: [Color(hex: 0x7DD87D, opacity: 0.32), .clear],
                center: UnitPoint(x: 0.8, y: 1.1),
                startRadius: 0,
                endRadius: 420
            )
            .blendMode(.screen)
            .ignoresSafeArea()

            content
        }
    }
}

public extension View {
    /// Applies the Variant C purple-to-green wallpaper. Use on screen-root containers only.
    func kolaWallpaper() -> some View { modifier(GradientWallpaper()) }
}
