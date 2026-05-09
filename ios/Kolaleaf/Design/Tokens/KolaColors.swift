// KolaColors.swift
// Brand color tokens. Source of truth: Resources/Tokens.json (mirrored from approved.json).
// Update both files together; never hard-code hex values outside this file.

import SwiftUI

public enum KolaColors {
    // MARK: - Brand
    public static let purple      = Color(hex: 0x2D1B69)
    public static let green       = Color(hex: 0x1A6B3C)
    public static let greenLight  = Color(hex: 0x7DD87D)

    // MARK: - Status
    public static let gold        = Color(hex: 0xFFD700) // warn / KYC review
    public static let coral       = Color(hex: 0xFF8A8A) // error
    public static let coralDeep   = Color(hex: 0xC8102E) // error CTA gradient end

    // MARK: - Neutrals
    public static let ink         = Color(hex: 0x1A1A2E) // primary text
    public static let pageLight   = Color(hex: 0xF5F5F5) // light page bg (used on share-receipt only)
    public static let muted       = Color(hex: 0x888888)

    // MARK: - On-gradient text (per AA contrast fix from r1 review)
    public static let whiteOnGradient       = Color.white.opacity(0.78)
    public static let whiteOnGradientMuted  = Color.white.opacity(0.55)

    // MARK: - Frosted-glass surface
    public enum Frosted {
        public static let background = Color.white.opacity(0.13)
        public static let border     = Color.white.opacity(0.18)
        public static let blurRadius: CGFloat = 20
    }

    // MARK: - Wallpaper gradient stops
    public static let wallpaperStops: [Gradient.Stop] = [
        .init(color: Color(hex: 0x1F1148), location: 0.0),
        .init(color: Color(hex: 0x2D1B69), location: 0.35),
        .init(color: Color(hex: 0x1A6B3C), location: 1.0),
    ]
}

// MARK: - Hex initialiser

public extension Color {
    /// Initializes a Color from an RGB hex value (e.g. 0x2D1B69).
    init(hex: UInt32, opacity: Double = 1.0) {
        let r = Double((hex >> 16) & 0xFF) / 255.0
        let g = Double((hex >> 8)  & 0xFF) / 255.0
        let b = Double(hex         & 0xFF) / 255.0
        self.init(.sRGB, red: r, green: g, blue: b, opacity: opacity)
    }
}
