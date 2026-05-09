// HitTarget44.swift
// Expands tappable area to ≥44×44pt without changing visual size, per Apple HIG and WCAG 2.5.5.
// Use on small icons (back chevrons, dismiss buttons, single-glyph affordances).

import SwiftUI

public struct HitTarget44: ViewModifier {
    public func body(content: Content) -> some View {
        content
            .frame(minWidth: KolaSpacing.hitTarget,
                   minHeight: KolaSpacing.hitTarget)
            .contentShape(Rectangle())
    }
}

public extension View {
    /// Pads the view's hit area to a minimum 44×44pt square while preserving its visual size.
    func hitTarget44() -> some View { modifier(HitTarget44()) }
}
