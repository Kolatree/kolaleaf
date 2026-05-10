// FrostedGlass.swift  (Phase 0.6 · Vectors brand pivot)
// Light card surface modifier — white background, 1 px border, soft shadow.
//
// The Phase 0 `.ultraThinMaterial` translucent treatment is replaced per
// the Vectors §6 card spec (white card, `1 px` `#DDE6E1` border, shadow
// `0 8px 24px rgba(11, 23, 19, 0.08)`). The modifier name and call-sites
// (`kolaFrosted(.card)`) stay so existing views compile; the visual is now
// premium-light instead of dark-frosted.
//
// IMPORTANT (kept from Phase 0): for share-receipt PNGs (U92), use
// `ShareableReceiptView` which already renders solid-colour cards — Phase
// 0.6 doesn't change that surface, but the `Card` background being solid
// white means the ImageRenderer regression is now moot.

import SwiftUI

public enum FrostedShape {
    case card           // 16pt corner radius
    case cardLarge      // 22pt corner radius
    case pill           // fully rounded
    case sheet          // 24pt corner radius

    var radius: CGFloat {
        switch self {
        case .card:      return KolaRadius.card
        case .cardLarge: return KolaRadius.cardLg
        case .pill:      return KolaRadius.pill
        case .sheet:     return KolaRadius.hero
        }
    }
}

public struct FrostedGlass: ViewModifier {
    let shape: FrostedShape
    let highContrast: Bool

    public func body(content: Content) -> some View {
        content
            .background(backgroundLayer)
            .overlay(borderLayer)
            .clipShape(RoundedRectangle(cornerRadius: shape.radius, style: .continuous))
            .shadow(
                color: KolaColors.Card.shadow,
                radius: KolaColors.Card.shadowRadius,
                x: 0,
                y: KolaColors.Card.shadowY
            )
    }

    @ViewBuilder
    private var backgroundLayer: some View {
        if highContrast {
            // Accessibility variant: opaque ink card (high-contrast mode).
            RoundedRectangle(cornerRadius: shape.radius, style: .continuous)
                .fill(KolaColors.ink)
        } else {
            RoundedRectangle(cornerRadius: shape.radius, style: .continuous)
                .fill(KolaColors.Card.background)
        }
    }

    private var borderLayer: some View {
        RoundedRectangle(cornerRadius: shape.radius, style: .continuous)
            .strokeBorder(KolaColors.Card.border, lineWidth: 1)
    }
}

public extension View {
    /// Apply the Vectors-spec light card surface treatment.
    /// - Parameter shape: corner-radius variant. Defaults to `.card` (16 pt).
    /// - Parameter highContrast: opaque ink card for `.accessibilityReduceTransparency`.
    func kolaFrosted(_ shape: FrostedShape = .card, highContrast: Bool = false) -> some View {
        modifier(FrostedGlass(shape: shape, highContrast: highContrast))
    }

    /// Semantic alias — `kolaCard()` reads more naturally now that the
    /// surface is no longer frosted glass.
    func kolaCard(_ shape: FrostedShape = .card, highContrast: Bool = false) -> some View {
        modifier(FrostedGlass(shape: shape, highContrast: highContrast))
    }
}
