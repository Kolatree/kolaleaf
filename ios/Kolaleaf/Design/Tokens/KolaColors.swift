// KolaColors.swift  (Phase 0.6 · Vectors brand pivot)
// Design system source: docs/Kolaleaf Vectors /kolaleaf_money_remittance_website_design_system.md
//
// The Phase 0 variant-C palette (purple→green gradient, dark theme, frosted
// glass) is superseded by the Vectors design system: Trust Green primary,
// Hope Gold accent, white/cream surfaces, 70/20/10 colour-ratio rule.

import SwiftUI

public enum KolaColors {

    // MARK: - Brand (Vectors §3 core brand colours)

    /// `brand.green.900` — Trust Green. Primary brand colour: hero CTAs,
    /// headers, core logo colour. Anchors the "trust-first" identity.
    public static let trustGreen   = Color(hex: 0x014D35)
    /// `brand.green.800` — Kolaleaf Green. Wordmark colour, nav active state,
    /// primary UI text accents.
    public static let kolaGreen    = Color(hex: 0x03553C)
    /// `brand.green.500` — Leaf Green. Success states, growth highlights,
    /// secondary CTA accents.
    public static let leafGreen    = Color(hex: 0x289F2A)
    /// `brand.gold.300` — Hope Gold. Tagline, warm highlights, premium
    /// details. Use sparingly per the 10% accent allowance.
    public static let hopeGold     = Color(hex: 0xF6D09A)

    // MARK: - Aliases for token migration (Phase 0 → Phase 0.6)
    //
    // The view layer historically references `KolaColors.green` and
    // `.greenLight` on every CTA / progress ring / step row. Aliases keep
    // the surgical sweep tractable: views that say "green CTA" still mean
    // the same thing visually, just remapped to the new palette.
    public static let green        = trustGreen
    public static let greenLight   = leafGreen
    public static let gold         = hopeGold

    // MARK: - Semantic / status

    /// `danger.600` — destructive actions, validation errors.
    public static let coral        = Color(hex: 0xD92D20)
    /// Same as `coral` at v1 ship — kept distinct for downstream callers
    /// that may want a deeper red for filled gradient ends later.
    public static let coralDeep    = Color(hex: 0xD92D20)
    /// `warning.500` — warnings + pending transfers (KYC processing).
    public static let warning      = Color(hex: 0xF79009)
    /// `info.600` — informational tags / banners.
    public static let info         = Color(hex: 0x1570EF)

    // MARK: - Neutrals + surfaces (Vectors §3 extended palette)

    /// `neutral.950` — primary text on light backgrounds (most copy).
    public static let ink          = Color(hex: 0x0B1713)
    /// `neutral.800` — secondary headings, dark UI text.
    public static let inkSubtle    = Color(hex: 0x1F2F29)
    /// `neutral.600` — body copy, helper text.
    public static let muted        = Color(hex: 0x5E6F68)
    /// `neutral.400` — disabled text, placeholder text.
    public static let mutedDisabled = Color(hex: 0x9AA8A2)
    /// `neutral.200` — borders, dividers.
    public static let border       = Color(hex: 0xDDE6E1)
    /// `neutral.100` — soft card backgrounds, badge surface.
    public static let surfaceSoft  = Color(hex: 0xF3F7F5)
    /// `neutral.50` — page background.
    public static let surface      = Color(hex: 0xFAFCFB)
    /// `cream.50` — warm finance/lifestyle sections.
    public static let cream        = Color(hex: 0xFFF8EF)

    /// Page background alias for callers that referenced `pageLight`.
    public static let pageLight    = surface

    // MARK: - Text-on-surface (replaces Phase 0 white-on-gradient family)
    //
    // The Phase 0 design put white text on a purple→green gradient. Phase
    // 0.6 inverts: dark text on white/cream surfaces. The two semantic
    // tokens below carry the same intent (primary heading vs. muted
    // subtitle) so existing call-sites keep their meaning while the visual
    // shifts cleanly.
    public static let textPrimary       = ink
    public static let textSecondary     = muted

    /// Legacy aliases — kept ONLY for the Phase 0.6 sweep so this commit
    /// can land before all views are touched. Subsequent commits will rename
    /// call-sites to `textPrimary` / `textSecondary` and these aliases will
    /// be removed. Do not introduce new references.
    public static let whiteOnGradient       = textPrimary
    public static let whiteOnGradientMuted  = textSecondary

    // MARK: - Card surface (replaces Phase 0 Frosted family)

    public enum Card {
        /// White card body — see `kolaCard()` modifier.
        public static let background = Color.white
        /// `neutral.200` — soft 1 px border on cards / inputs.
        public static let border     = KolaColors.border
        /// Card shadow per Vectors §5: `0 8px 24px rgba(11, 23, 19, 0.08)`.
        public static let shadow     = Color(hex: 0x0B1713, opacity: 0.08)
        public static let shadowRadius: CGFloat = 24
        public static let shadowY:      CGFloat = 8
    }

    /// Aliases for the Phase 0 `Frosted` namespace.
    public enum Frosted {
        public static let background = Card.background
        public static let border     = Card.border
        public static let blurRadius: CGFloat = 0
    }

    // MARK: - Wallpaper stops (light)

    /// Page wallpaper now uses a soft `surface → cream` gradient instead of
    /// the Phase 0 dark purple→green wallpaper. The hero brief calls for a
    /// `linear-gradient(180deg, #FAFCFB 0%, #FFF8EF 100%)`.
    public static let wallpaperStops: [Gradient.Stop] = [
        .init(color: surface, location: 0.0),
        .init(color: cream,   location: 1.0),
    ]
}

// MARK: - Hex initialiser

public extension Color {
    /// Initializes a Color from an RGB hex value (e.g. 0x014D35).
    init(hex: UInt32, opacity: Double = 1.0) {
        let r = Double((hex >> 16) & 0xFF) / 255.0
        let g = Double((hex >> 8)  & 0xFF) / 255.0
        let b = Double(hex         & 0xFF) / 255.0
        self.init(.sRGB, red: r, green: g, blue: b, opacity: opacity)
    }
}
