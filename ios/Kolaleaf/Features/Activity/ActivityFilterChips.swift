// ActivityFilterChips.swift  (Phase 8 · U55)
// Horizontal scroll of pill chips for the Activity tab. The view is a
// pure renderer over `ActivityViewModel.FilterChip` so tests can
// assert against the enum without spinning a SwiftUI host.

import SwiftUI

public struct ActivityFilterChips: View {

    @Binding public var selection: ActivityViewModel.FilterChip

    public init(selection: Binding<ActivityViewModel.FilterChip>) {
        self._selection = selection
    }

    public var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: KolaSpacing.s) {
                ForEach(ActivityViewModel.FilterChip.allCases) { chip in
                    chipButton(chip)
                }
            }
            .padding(.horizontal, KolaSpacing.xl)
        }
    }

    @ViewBuilder
    private func chipButton(_ chip: ActivityViewModel.FilterChip) -> some View {
        let isActive = (chip == selection)
        Button {
            selection = chip
        } label: {
            Text(chip.displayName)
                .font(KolaFont.chip)
                .kerning(KolaKerning.cta)
                .padding(.vertical, KolaSpacing.s)
                .padding(.horizontal, KolaSpacing.xl)
                .frame(minHeight: KolaSpacing.hitTarget)
                .background(
                    Capsule().fill(
                        isActive ? KolaColors.trustGreen : KolaColors.surfaceSoft
                    )
                )
                .foregroundStyle(
                    isActive ? Color.white : KolaColors.textPrimary
                )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(chip.displayName)
        .accessibilityAddTraits(isActive ? [.isSelected] : [])
    }
}
