// KolaTypography.swift
// Inter typeface tokens. Inter must be bundled in Resources/Inter-fonts/ and registered in Info.plist UIAppFonts.
// All amount + timestamp tokens use monospacedDigit() for tabular alignment.
//
// Note on kerning/letterSpacing: SwiftUI applies kerning via `Text(...).kerning(value)`,
// not on Font. Tokens that need negative tracking (logo, headline, amounts) carry their
// kerning value as a separate constant; views apply `.kerning(KolaKerning.headline)` to
// the Text directly.

import SwiftUI

public enum KolaFont {
    private static let family = "Inter"

    // MARK: - Headline & body
    public static let logo:        Font = .custom("\(family)-Bold",      size: 22)
    public static let tagline:     Font = .custom("\(family)-Regular",   size: 13)
    public static let headline:    Font = .custom("\(family)-ExtraBold", size: 32)
    public static let pageTitle:   Font = .custom("\(family)-ExtraBold", size: 22)
    public static let section:     Font = .custom("\(family)-Bold",      size: 18)

    // MARK: - Field labels
    /// Render with `.textCase(.uppercase)` and `.kerning(KolaKerning.label)` at the call site.
    public static let fieldLabel:  Font = .custom("\(family)-SemiBold",  size: 11)
    public static let row:         Font = .custom("\(family)-Regular",   size: 14)
    public static let rowValue:    Font = .custom("\(family)-SemiBold",  size: 14)
    public static let rowTotal:    Font = .custom("\(family)-Bold",      size: 14)

    // MARK: - Amounts (tabular numerals)
    public static let amountHero:    Font = .custom("\(family)-ExtraBold", size: 96).monospacedDigit()
    public static let amountLarge:   Font = .custom("\(family)-Bold",      size: 56).monospacedDigit()
    public static let amountMedium:  Font = .custom("\(family)-Bold",      size: 36).monospacedDigit()
    public static let amountSmall:   Font = .custom("\(family)-SemiBold",  size: 18).monospacedDigit()
    public static let ngnAccent:     Font = .custom("\(family)-SemiBold",  size: 32).monospacedDigit()
    public static let timestamp:     Font = .custom("\(family)-Regular",   size: 11).monospacedDigit()

    // MARK: - CTAs and chips
    public static let cta:         Font = .custom("\(family)-Bold",      size: 16)
    public static let chip:        Font = .custom("\(family)-SemiBold",  size: 11)
    public static let trust:       Font = .custom("\(family)-SemiBold",  size: 11)
    public static let navLabel:    Font = .custom("\(family)-Medium",    size: 10)
}

/// Kerning constants applied at the Text view level (SwiftUI's Font has no kerning API).
public enum KolaKerning {
    public static let logo:     CGFloat = -0.5
    public static let headline: CGFloat = -0.5
    public static let label:    CGFloat =  1.2  // small-caps style
    public static let cta:      CGFloat =  0.3
    public static let amount:   CGFloat = -1.5
    public static let amountHero: CGFloat = -3.0
}
