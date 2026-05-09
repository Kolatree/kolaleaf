// FrostedGlass.swift
// Translucent surface modifier wrapping `.ultraThinMaterial` with a tinted overlay and
// 1px white-18% stroke. Three radius variants: card / pill / sheet.
//
// IMPORTANT: `.ultraThinMaterial` does NOT render correctly inside SwiftUI's `ImageRenderer`
// (it samples an underlying view hierarchy that doesn't exist in offscreen rendering).
// For the share-receipt PNG (U92), use `ShareableReceiptView` which renders with
// solid-color cards instead. See plan U92 + r2 risks table.

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
    }

    @ViewBuilder
    private var backgroundLayer: some View {
        if highContrast {
            // Accessibility: opaque card against the gradient.
            RoundedRectangle(cornerRadius: shape.radius, style: .continuous)
                .fill(KolaColors.ink.opacity(0.88))
        } else {
            RoundedRectangle(cornerRadius: shape.radius, style: .continuous)
                .fill(.ultraThinMaterial)
                .overlay(
                    RoundedRectangle(cornerRadius: shape.radius, style: .continuous)
                        .fill(KolaColors.Frosted.background)
                )
        }
    }

    private var borderLayer: some View {
        RoundedRectangle(cornerRadius: shape.radius, style: .continuous)
            .strokeBorder(KolaColors.Frosted.border, lineWidth: 1)
    }
}

public extension View {
    /// Apply Kolaleaf frosted-glass surface treatment.
    /// - Parameter shape: corner-radius variant. Defaults to `.card`.
    /// - Parameter highContrast: pass `true` when `.accessibilityReduceTransparency`
    ///   environment is on; renders an opaque card for AA contrast.
    func kolaFrosted(_ shape: FrostedShape = .card, highContrast: Bool = false) -> some View {
        modifier(FrostedGlass(shape: shape, highContrast: highContrast))
    }
}
