// GradientWallpaper.swift  (Phase 0.6 · Vectors brand pivot)
// Light page wallpaper: soft `surface → cream` vertical gradient.
//
// The Phase 0 variant-C wallpaper (165° purple→green linear with two radial
// blooms) is replaced. Vectors §8 hero spec calls for `linear-gradient(180deg,
// #FAFCFB 0%, #FFF8EF 100%)` — premium clarity, finance-grade trust, no
// "neon gradient" marketing energy. Apply with `.kolaWallpaper()` on a
// screen-root container.

import SwiftUI

public struct GradientWallpaper: ViewModifier {
    public func body(content: Content) -> some View {
        ZStack {
            LinearGradient(
                gradient: Gradient(stops: KolaColors.wallpaperStops),
                startPoint: .top,
                endPoint:   .bottom
            )
            .ignoresSafeArea()

            content
        }
    }
}

public extension View {
    /// Applies the Vectors light page wallpaper. Use on screen-root containers.
    func kolaWallpaper() -> some View { modifier(GradientWallpaper()) }
}
