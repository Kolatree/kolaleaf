// KolaErrorCard.swift  (Phase 5 · OO-104)
// Shared chrome for the in-form warning/error cards used by
// `ResolvedNameCard` (`.notFound`, `.bankDown`, `.bankDownExhausted`).
// Extracted so the three variants don't each duplicate the
// background-tint-at-8% + border-at-30% + padding + corner-radius
// recipe.
//
// The variant supplies copy, icon, tint colour, and an optional
// retry CTA. The card supplies the chrome AND the accessibility
// scaffolding: the title + body merge into one element so VoiceOver
// reads them as one announcement, but the Retry button is a
// SEPARATE focusable element so it can be activated with VoiceOver
// (ADV5-003 fix). The previous .accessibilityElement(.combine) on
// the outer container flattened the button into the announcement
// and stripped it of focusability — on a money-routing screen,
// that's the entire recovery path lost to a screen-reader user.

import SwiftUI

public struct KolaErrorCard: View {

    public struct RetryAction {
        public let label: String
        public let hint: String
        public let perform: () -> Void

        public init(label: String, hint: String, perform: @escaping () -> Void) {
            self.label = label
            self.hint = hint
            self.perform = perform
        }
    }

    private let tint: Color
    private let iconSystemName: String
    private let title: String
    private let message: String
    private let retry: RetryAction?

    public init(
        tint: Color,
        iconSystemName: String,
        title: String,
        message: String,
        retry: RetryAction? = nil
    ) {
        self.tint = tint
        self.iconSystemName = iconSystemName
        self.title = title
        self.message = message
        self.retry = retry
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: KolaSpacing.s) {
            // Title + body merged into one VoiceOver announcement so
            // screen-reader users hear the full context as a single
            // sentence. The Retry button is INTENTIONALLY outside
            // this combined element so it remains independently
            // focusable and activatable (ADV5-003 fix).
            VStack(alignment: .leading, spacing: KolaSpacing.s) {
                HStack(spacing: KolaSpacing.s) {
                    Image(systemName: iconSystemName)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(tint)
                    Text(title)
                        .font(KolaFont.rowValue)
                        .foregroundStyle(tint)
                        .lineLimit(2)
                }
                Text(message)
                    .font(KolaFont.tagline)
                    .foregroundStyle(KolaColors.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("\(title). \(message)")

            if let retry {
                Button(action: retry.perform) {
                    Text(retry.label)
                        .font(KolaFont.cta)
                        .kerning(KolaKerning.cta)
                        .foregroundStyle(tint)
                        .padding(.horizontal, KolaSpacing.l)
                        .padding(.vertical, KolaSpacing.s)
                        .frame(minHeight: KolaSpacing.hitTarget)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(retry.label)
                .accessibilityHint(retry.hint)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, KolaSpacing.xl)
        .padding(.vertical, KolaSpacing.l)
        .background(
            RoundedRectangle(cornerRadius: KolaRadius.card, style: .continuous)
                .fill(tint.opacity(0.08))
        )
        .overlay(
            RoundedRectangle(cornerRadius: KolaRadius.card, style: .continuous)
                .strokeBorder(tint.opacity(0.30), lineWidth: 1)
        )
    }
}
