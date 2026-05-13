// KolaColors+Core.swift  (Phase 10A iter-2 · CA-1004 split)
// Core token surface that BOTH the app and the widget extension
// compile. Kept deliberately small so the widget binary stays under
// the ActivityKit extension budget.
//
// The widget process imports ONLY this file (see project.yml widget
// sources). The app target compiles BOTH this file and the
// `+AppOnly.swift` companion which re-extends `KolaColors` with the
// migration aliases / Frosted namespace / wallpaper stops.
//
// Public API is unchanged — both files extend `enum KolaColors`. All
// existing call sites continue to work.

import SwiftUI

public enum KolaColors {

    // MARK: - Brand (Vectors §3 core brand colours)

    /// `brand.green.900` — Trust Green. Primary brand colour.
    public static let trustGreen   = Color(hex: 0x014D35)
    /// `brand.green.500` — Leaf Green. Success states.
    public static let leafGreen    = Color(hex: 0x289F2A)

    // MARK: - Semantic / status

    /// `danger.600` — destructive actions, validation errors.
    public static let coral        = Color(hex: 0xD92D20)
    /// `warning.500` — warnings + pending transfers (KYC processing).
    public static let warning      = Color(hex: 0xF79009)
    /// `info.600` — informational tags / banners.
    public static let info         = Color(hex: 0x1570EF)

    // MARK: - Neutrals + surfaces

    /// `neutral.950` — primary text on light backgrounds (most copy).
    public static let ink          = Color(hex: 0x0B1713)
    /// `neutral.600` — body copy, helper text.
    public static let muted        = Color(hex: 0x5E6F68)
    /// `neutral.200` — borders, dividers.
    public static let border       = Color(hex: 0xDDE6E1)
    /// `neutral.50` — page background.
    public static let surface      = Color(hex: 0xFAFCFB)

    // MARK: - Aliases consumed by the widget surfaces
    //
    // These keep the widget views readable without dragging in the
    // app-only legacy aliases / migration shims (which live in
    // `+AppOnly.swift`).

    /// Alias for the Trust Green primary — kept for symmetry with the
    /// "primary" naming used elsewhere in the design system.
    public static let primary      = trustGreen
    /// Alias for the Leaf Green success colour.
    public static let success      = leafGreen
    /// Hope Gold accent — duplicated here so widget surfaces can lean
    /// on the warm highlight without pulling the migration shims.
    public static let accent       = Color(hex: 0xF6D09A)
    /// Coral alias for "danger" semantic.
    public static let danger       = coral
    /// Coral alias for "error" semantic — same hue, distinct intent.
    public static let error        = coral
}

// MARK: - Hex initialiser (shared by both targets via this file)

public extension Color {
    /// Initializes a Color from an RGB hex value (e.g. 0x014D35).
    init(hex: UInt32, opacity: Double = 1.0) {
        let r = Double((hex >> 16) & 0xFF) / 255.0
        let g = Double((hex >> 8)  & 0xFF) / 255.0
        let b = Double(hex         & 0xFF) / 255.0
        self.init(.sRGB, red: r, green: g, blue: b, opacity: opacity)
    }
}
