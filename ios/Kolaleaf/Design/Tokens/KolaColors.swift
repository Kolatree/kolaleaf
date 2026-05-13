// KolaColors.swift  (Phase 0.6 · Vectors brand pivot · APP-ONLY)
// Design system source: docs/Kolaleaf Vectors /kolaleaf_money_remittance_website_design_system.md
//
// CA-1004 (Phase 10A iter-2): the core tokens the widget extension
// needs (trustGreen, leafGreen, ink, muted, border, surface, warning,
// info, coral, primary, accent, success, danger, error) moved to
// `KolaColors+Core.swift` so the widget binary can compile a tiny
// subset. THIS file holds the app-only migration aliases / Frosted
// namespace / wallpaper stops and is NOT included in the widget
// target's source list.
//
// Public API is preserved — both files extend `enum KolaColors`. Call
// sites that read e.g. `KolaColors.green` continue to work.

import SwiftUI

public extension KolaColors {

    // MARK: - Brand (Vectors §3 core brand colours · app-only extras)

    /// `brand.green.800` — Kolaleaf Green. Wordmark colour, nav active state,
    /// primary UI text accents.
    static let kolaGreen    = Color(hex: 0x03553C)
    /// `brand.gold.300` — Hope Gold. Tagline, warm highlights, premium
    /// details. Use sparingly per the 10% accent allowance.
    static let hopeGold     = Color(hex: 0xF6D09A)

    // MARK: - Aliases for token migration (Phase 0 → Phase 0.6)
    //
    // The view layer historically references `KolaColors.green` and
    // `.greenLight` on every CTA / progress ring / step row. Aliases keep
    // the surgical sweep tractable: views that say "green CTA" still mean
    // the same thing visually, just remapped to the new palette.
    static let green        = trustGreen
    static let greenLight   = leafGreen
    static let gold         = hopeGold

    // MARK: - Semantic / status (app-only extras)

    /// Same as `coral` at v1 ship — kept distinct for downstream callers
    /// that may want a deeper red for filled gradient ends later.
    static let coralDeep    = Color(hex: 0xD92D20)

    // MARK: - Neutrals + surfaces (Vectors §3 extended palette · app-only)

    /// `neutral.800` — secondary headings, dark UI text.
    static let inkSubtle    = Color(hex: 0x1F2F29)
    /// `neutral.400` — disabled text, placeholder text.
    static let mutedDisabled = Color(hex: 0x9AA8A2)
    /// `neutral.100` — soft card backgrounds, badge surface.
    static let surfaceSoft  = Color(hex: 0xF3F7F5)
    /// `cream.50` — warm finance/lifestyle sections.
    static let cream        = Color(hex: 0xFFF8EF)

    /// Page background alias for callers that referenced `pageLight`.
    static let pageLight    = surface

    // MARK: - Text-on-surface (replaces Phase 0 white-on-gradient family)
    //
    // The Phase 0 design put white text on a purple→green gradient. Phase
    // 0.6 inverts: dark text on white/cream surfaces. The two semantic
    // tokens below carry the same intent (primary heading vs. muted
    // subtitle) so existing call-sites keep their meaning while the visual
    // shifts cleanly.
    static let textPrimary       = ink
    static let textSecondary     = muted

    /// Legacy aliases — kept ONLY for the Phase 0.6 sweep so this commit
    /// can land before all views are touched. Subsequent commits will rename
    /// call-sites to `textPrimary` / `textSecondary` and these aliases will
    /// be removed. Do not introduce new references.
    static let whiteOnGradient       = textPrimary
    static let whiteOnGradientMuted  = textSecondary

    // MARK: - Card surface (replaces Phase 0 Frosted family)

    enum Card {
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
    enum Frosted {
        public static let background = Card.background
        public static let border     = Card.border
        public static let blurRadius: CGFloat = 0
    }

    // MARK: - Wallpaper stops (light)

    /// Page wallpaper now uses a soft `surface → cream` gradient instead of
    /// the Phase 0 dark purple→green wallpaper. The hero brief calls for a
    /// `linear-gradient(180deg, #FAFCFB 0%, #FFF8EF 100%)`.
    static let wallpaperStops: [Gradient.Stop] = [
        .init(color: surface, location: 0.0),
        .init(color: cream,   location: 1.0),
    ]
}
