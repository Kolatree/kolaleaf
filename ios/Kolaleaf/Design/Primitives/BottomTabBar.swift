// BottomTabBar.swift  (Phase 4 · U33)
// Four-tab bottom bar for `MainTabView`. Pure View — owns no state
// besides what the binding tells it. The selected tab is always the
// source of truth, never recreated locally.
//
// Visual:
//   • White card surface (Vectors §6 card spec) with a 1 px border
//     and the standard shadow — same surface as `kolaCard()` so the
//     bottom bar reads as a continuation of the surface system.
//   • Active tab uses `KolaColors.trustGreen` for icon + label.
//   • Inactive tabs use `KolaColors.muted`.
//   • Each tab is a 44 pt minimum hit-target per HIG.
//
// Iteration 2 / API-103 + CA-003 fix: the `items:` parameter was
// dropped — there's no real subset use case and the implicit
// `RootTab.allCases` ordering became a hidden contract. Icon + label
// tables moved onto `RootTab` itself so this View shrinks to a pure
// `ForEach(RootTab.allCases)`.

import SwiftUI

public struct BottomTabBar: View {
    @Binding private var selection: RootTab

    public init(selection: Binding<RootTab>) {
        self._selection = selection
    }

    public var body: some View {
        HStack(spacing: 0) {
            ForEach(RootTab.allCases, id: \.self) { tab in
                tabButton(for: tab)
            }
        }
        .padding(.vertical, KolaSpacing.s)
        .padding(.horizontal, KolaSpacing.s)
        .padding(.bottom, KolaSpacing.s)
        .background(KolaColors.Card.background)
        .overlay(alignment: .top) {
            // Hairline divider between the bar and the content above it.
            Rectangle()
                .fill(KolaColors.Card.border)
                .frame(height: 0.5)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Tab bar")
    }

    @ViewBuilder
    private func tabButton(for tab: RootTab) -> some View {
        let isSelected = selection == tab
        Button {
            if selection != tab {
                selection = tab
            }
        } label: {
            VStack(spacing: KolaSpacing.xxs) {
                Image(systemName: tab.systemIcon(selected: isSelected))
                    .font(.system(size: 20, weight: isSelected ? .semibold : .regular))
                Text(tab.label)
                    .font(KolaFont.navLabel)
            }
            .foregroundStyle(isSelected ? KolaColors.trustGreen : KolaColors.muted)
            .frame(maxWidth: .infinity, minHeight: KolaSpacing.hitTarget)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(tab.label)
        .accessibilityAddTraits(isSelected ? [.isSelected, .isButton] : [.isButton])
    }
}
