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

    private static func custom(
        _ face: String,
        size: CGFloat,
        relativeTo textStyle: Font.TextStyle
    ) -> Font {
        .custom("\(family)-\(face)", size: size, relativeTo: textStyle)
    }

    // MARK: - Headline & body
    public static let logo:        Font = custom("Bold",      size: 22, relativeTo: .title3)
    public static let tagline:     Font = custom("Regular",   size: 13, relativeTo: .subheadline)
    public static let headline:    Font = custom("ExtraBold", size: 32, relativeTo: .largeTitle)
    public static let pageTitle:   Font = custom("ExtraBold", size: 22, relativeTo: .title2)
    public static let section:     Font = custom("Bold",      size: 18, relativeTo: .headline)

    // MARK: - Field labels
    /// Render with `.textCase(.uppercase)` and `.kerning(KolaKerning.label)` at the call site.
    public static let fieldLabel:  Font = custom("SemiBold",  size: 11, relativeTo: .caption)
    public static let row:         Font = custom("Regular",   size: 14, relativeTo: .body)
    public static let rowValue:    Font = custom("SemiBold",  size: 14, relativeTo: .body)
    public static let rowTotal:    Font = custom("Bold",      size: 14, relativeTo: .body)

    // MARK: - Amounts (tabular numerals)
    public static let amountHero:    Font = custom("ExtraBold", size: 96, relativeTo: .largeTitle).monospacedDigit()
    public static let amountLarge:   Font = custom("Bold",      size: 56, relativeTo: .largeTitle).monospacedDigit()
    public static let amountMedium:  Font = custom("Bold",      size: 36, relativeTo: .title).monospacedDigit()
    public static let amountSmall:   Font = custom("SemiBold",  size: 18, relativeTo: .title3).monospacedDigit()
    public static let ngnAccent:     Font = custom("SemiBold",  size: 32, relativeTo: .title).monospacedDigit()
    public static let timestamp:     Font = custom("Regular",   size: 11, relativeTo: .caption2).monospacedDigit()

    // MARK: - CTAs and chips
    public static let cta:         Font = custom("Bold",      size: 16, relativeTo: .body)
    public static let chip:        Font = custom("SemiBold",  size: 11, relativeTo: .caption)
    public static let trust:       Font = custom("SemiBold",  size: 11, relativeTo: .caption)
    public static let navLabel:    Font = custom("Medium",    size: 10, relativeTo: .caption2)
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
