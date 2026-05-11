// ResolvedNameCard.swift  (Phase 4 · U37 · partial — Phase 5 finishes the variants)
// Renders the resolved-account-holder card under the AccountNumber
// field on AddRecipientView.
//
// Phase 4 ships ONLY the `.resolved(name)` variant fully styled — a
// green frosted card with a check icon and the holder name. The
// other ResolveState variants render minimal, intentionally
// unstyled placeholder labels with a TODO comment pointing at the
// Phase 5 units (U38 resolving spinner, U39 notFound CTA, U40
// bankDown auto-retry banner).
//
// Keeping the variants lightly stubbed instead of polished avoids
// shipping a half-done UX that we'd then have to throw away when
// Phase 5 lands.

import SwiftUI

public struct ResolvedNameCard: View {
    private let state: ResolveState

    public init(state: ResolveState) {
        self.state = state
    }

    public var body: some View {
        switch state {
        case .resolved(let name, _, _):
            resolvedCard(name: name)
        case .resolving:
            // Phase 5 / U38 replaces this with the inline spinner.
            placeholder("Checking account…")
        case .notFound:
            // Phase 5 / U39 replaces this with the not-found CTA.
            placeholder("We couldn't find that account.")
        case .bankDown:
            // Phase 5 / U40 replaces this with the auto-retry banner.
            placeholder("Bank is unreachable. We'll retry shortly.")
        case .sessionExpired:
            // The VM also surfaces this via `lastError = .sessionExpired`
            // and routes to re-auth; this label is a defensive fallback
            // for the moment between state-change and AppState handler.
            placeholder("Your session expired. Please sign in again.")
        case .idle:
            EmptyView()
        }
    }

    private func resolvedCard(name: String) -> some View {
        HStack(spacing: KolaSpacing.m) {
            ZStack {
                Circle()
                    .fill(KolaColors.leafGreen.opacity(0.15))
                    .frame(width: 32, height: 32)
                Image(systemName: "checkmark")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(KolaColors.leafGreen)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("Account holder")
                    .font(KolaFont.fieldLabel)
                    .kerning(KolaKerning.label)
                    .textCase(.uppercase)
                    .foregroundStyle(KolaColors.textSecondary)
                Text(name)
                    .font(KolaFont.rowValue)
                    .foregroundStyle(KolaColors.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            Spacer()
        }
        .padding(.horizontal, KolaSpacing.xl)
        .padding(.vertical, KolaSpacing.l)
        .kolaFrosted(.card)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Account holder \(name), confirmed")
    }

    private func placeholder(_ text: String) -> some View {
        Text(text)
            .font(KolaFont.tagline)
            .foregroundStyle(KolaColors.textSecondary)
            .padding(.horizontal, KolaSpacing.xl)
            .padding(.vertical, KolaSpacing.l)
            .frame(maxWidth: .infinity, alignment: .leading)
            .kolaFrosted(.card)
    }
}
