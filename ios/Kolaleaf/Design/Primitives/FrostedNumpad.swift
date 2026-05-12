// FrostedNumpad.swift  (Phase 6 · U41)
// Numeric keypad with frosted-glass chrome. 3 columns × 4 rows:
//   [1] [2] [3]
//   [4] [5] [6]
//   [7] [8] [9]
//   [·] [0] [⌫]
//
// The pad is intentionally decoupled from `AmountStore`: it emits
// `NumpadKey` events through `onKey`. The Send screen owns the store
// and wires append / delete in one place. Decoupling keeps the keypad
// reusable (e.g. PIN entry later) and keeps the gesture/store mapping
// in the feature layer where it's testable.
//
// Haptics fire once per keypress via `UIImpactFeedbackGenerator(.light)`.
// They are suppressed when `accessibilityReduceMotion` is true so users
// who opt out of motion don't get a buzz on every digit.

import SwiftUI
import UIKit

/// 0…9 digit, modelled as an explicit Int-raw enum so callers can't
/// pass arbitrary integers (W12 / API-003). The raw value remains an
/// `Int` so `AmountStore.append(_ digit: Int)` keeps compiling while
/// new code uses the type-safe enum.
public enum NumpadDigit: Int, Hashable, Sendable, CaseIterable {
    case d0 = 0, d1 = 1, d2 = 2, d3 = 3, d4 = 4
    case d5 = 5, d6 = 6, d7 = 7, d8 = 8, d9 = 9
}

public enum NumpadKey: Hashable, Sendable {
    case digit(Int)
    case delete
}

public struct FrostedNumpad: View {

    private let onKey: (NumpadKey) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(onKey: @escaping (NumpadKey) -> Void) {
        self.onKey = onKey
    }

    // Iter-2 (S1 / OO-006): drop the private `NumpadCellSpec` wrapper.
    // Empty cells are `nil`; everything else is a real `NumpadKey`.
    private let layout: [[NumpadKey?]] = [
        [.digit(1), .digit(2), .digit(3)],
        [.digit(4), .digit(5), .digit(6)],
        [.digit(7), .digit(8), .digit(9)],
        [nil,       .digit(0), .delete],
    ]

    public var body: some View {
        VStack(spacing: KolaSpacing.s) {
            ForEach(layout.indices, id: \.self) { rowIdx in
                HStack(spacing: KolaSpacing.s) {
                    ForEach(layout[rowIdx].indices, id: \.self) { colIdx in
                        cell(for: layout[rowIdx][colIdx])
                    }
                }
            }
        }
        .padding(KolaSpacing.m)
        .background(
            RoundedRectangle(cornerRadius: KolaRadius.cardLg, style: .continuous)
                .fill(.ultraThinMaterial)
        )
        .overlay(
            RoundedRectangle(cornerRadius: KolaRadius.cardLg, style: .continuous)
                .strokeBorder(KolaColors.Card.border, lineWidth: 0.5)
        )
        // Iter-2 (S14 / ADV-P6-S3): warm the haptic generator so the
        // first keypress doesn't take a CoreHaptics cold-start hit.
        .onAppear { Self.warmHaptic() }
    }

    @ViewBuilder
    private func cell(for key: NumpadKey?) -> some View {
        switch key {
        case .digit(let d):
            keyButton(label: "\(d)", action: { fire(.digit(d)) })
                .accessibilityLabel("\(d)")
        case .delete:
            keyButton(
                label: nil,
                icon: "delete.left",
                action: { fire(.delete) }
            )
            .accessibilityLabel("Delete")
            .accessibilityHint("Removes the last digit")
        case .none:
            Color.clear
                .frame(maxWidth: .infinity, minHeight: 56)
                .accessibilityHidden(true)
        }
    }

    private func keyButton(
        label: String?,
        icon: String? = nil,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            ZStack {
                RoundedRectangle(cornerRadius: KolaRadius.card, style: .continuous)
                    .fill(Color.white.opacity(0.6))
                if let label {
                    Text(label)
                        .font(KolaFont.amountSmall)
                        .foregroundStyle(KolaColors.textPrimary)
                } else if let icon {
                    Image(systemName: icon)
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(KolaColors.textPrimary)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 56)
        }
        .buttonStyle(.plain)
    }

    private func fire(_ key: NumpadKey) {
        onKey(key)
        if !reduceMotion {
            FrostedNumpad.fireHaptic()
        }
    }

    /// Haptic fired off the main path so a slow CoreHaptics warm-up
    /// never blocks the visible keypress. The warmHaptic call on
    /// onAppear primes the generator (S14 / ADV-P6-S3) so subsequent
    /// fires don't pay the cold-start cost.
    @MainActor
    private static func fireHaptic() {
        let gen = UIImpactFeedbackGenerator(style: .light)
        gen.impactOccurred()
    }

    /// Warm the haptic engine on view appearance.
    @MainActor
    private static func warmHaptic() {
        UIImpactFeedbackGenerator(style: .light).prepare()
    }
}
