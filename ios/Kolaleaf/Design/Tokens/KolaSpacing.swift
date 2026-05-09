// KolaSpacing.swift / KolaRadius.swift / KolaMotion.swift
// Layout tokens — scalar values used across views. Never hard-code these in feature files.

import SwiftUI

public enum KolaSpacing {
    public static let xxs:  CGFloat = 2
    public static let xs:   CGFloat = 4
    public static let s:    CGFloat = 8
    public static let m:    CGFloat = 12
    public static let l:    CGFloat = 14
    public static let xl:   CGFloat = 16
    public static let xxl:  CGFloat = 18
    public static let xxxl: CGFloat = 22
    public static let card: CGFloat = 24

    /// Minimum tappable target per Apple HIG.
    public static let hitTarget: CGFloat = 44

    /// Bottom safe-area inset accounting for the home indicator.
    public static let homeIndicator: CGFloat = 28
}

public enum KolaRadius {
    public static let chipSmall: CGFloat = 6
    public static let chip:      CGFloat = 12
    public static let rateBar:   CGFloat = 8
    public static let cta:       CGFloat = 14
    public static let card:      CGFloat = 16
    public static let cardLg:    CGFloat = 22
    public static let hero:      CGFloat = 24
    public static let pill:      CGFloat = 100
}

public enum KolaMotion {
    /// Standard spring for state-machine row transitions and slide-pill snap-back.
    public static let springSnap: Animation = .spring(response: 0.35, dampingFraction: 0.78)

    /// Soft fade for tab-bar opacity during slide gesture and overlay reveals.
    public static let softFade:   Animation = .easeInOut(duration: 0.2)

    /// Tab-bar fade-out duration during slide-to-send (per design).
    public static let tabFadeOut: Double = 0.3
    /// Tab-bar fade-in duration after gesture release.
    public static let tabFadeIn:  Double = 0.2

    /// Reduce-motion variants — call when @Environment(\.accessibilityReduceMotion) is true.
    public static let reducedSnap: Animation = .linear(duration: 0.001) // effectively instant
    public static let reducedFade: Animation = .linear(duration: 0.05)

    /// Honor `prefersReducedMotion` for the chosen animation.
    public static func snap(reduce: Bool) -> Animation { reduce ? reducedSnap : springSnap }
    public static func fade(reduce: Bool) -> Animation { reduce ? reducedFade : softFade }
}
