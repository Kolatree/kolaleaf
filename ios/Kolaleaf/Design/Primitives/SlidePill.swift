// SlidePill.swift  (Phase 6 · U43 + U44)
// "Slide to send · Face ID" pill at the bottom of the Send screen.
// The gesture is intentionally heavyweight — confirming a money
// transfer should feel deliberate, not a one-tap commit.
//
// U43 ships the visual chrome only: frosted background, circular
// thumb, label, chevron shimmer hint, and a clamp on the thumb's X
// position so the caller can drive `dragX` from a test or preview.
//
// U44 adds the live DragGesture, the 75% threshold, the spring-back
// on release-before-threshold, and reduce-motion handling. Both
// pieces live in the same file so the gesture interpolation reads
// alongside the visual it animates.

import SwiftUI

public struct SlidePill: View {

    public typealias OnConfirm = () -> Void

    private let label: String
    private let onConfirm: OnConfirm
    private let isEnabled: Bool

    // Internal: when non-nil, overrides the live drag state so previews
    // and snapshot tests can render the pill at an intermediate position
    // without simulating a gesture.
    private let dragOverride: CGFloat?

    @State private var dragX: CGFloat = 0
    @State private var pillWidth: CGFloat = 0

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static let thumbWidth: CGFloat = 56
    private static let pillHeight: CGFloat = 64
    private static let confirmThreshold: CGFloat = 0.75

    public init(
        label: String = "Slide to send · Face ID",
        isEnabled: Bool = true,
        dragOverride: CGFloat? = nil,
        onConfirm: @escaping OnConfirm
    ) {
        self.label = label
        self.isEnabled = isEnabled
        self.dragOverride = dragOverride
        self.onConfirm = onConfirm
    }

    public var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                track
                shimmerChevrons
                    .padding(.leading, Self.thumbWidth + KolaSpacing.m)
                centerLabel
                thumb
                    .offset(x: currentDragX)
            }
            .onAppear { pillWidth = proxy.size.width }
            .onChange(of: proxy.size.width) { _, new in pillWidth = new }
        }
        .frame(height: Self.pillHeight)
        .opacity(isEnabled ? 1.0 : 0.4)
        .allowsHitTesting(isEnabled)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityHint("Slides right to confirm transfer with Face ID")
        .accessibilityAddTraits(.isButton)
    }

    // MARK: - Subviews

    private var track: some View {
        RoundedRectangle(cornerRadius: KolaRadius.pill, style: .continuous)
            .fill(.ultraThinMaterial)
            .overlay(
                RoundedRectangle(cornerRadius: KolaRadius.pill, style: .continuous)
                    .strokeBorder(KolaColors.trustGreen.opacity(0.30), lineWidth: 1)
            )
    }

    private var centerLabel: some View {
        Text(label)
            .font(KolaFont.cta)
            .kerning(KolaKerning.cta)
            .foregroundStyle(KolaColors.trustGreen)
            .frame(maxWidth: .infinity)
            .padding(.leading, Self.thumbWidth)
            // Fade out as the user drags so the pill commits visually.
            .opacity(max(0, 1.0 - (currentDragX / max(maxDrag, 1)) * 1.5))
    }

    @ViewBuilder
    private var shimmerChevrons: some View {
        // Iter-2 (S15 / ADV-P6-S4): reduce-motion users skip the
        // TimelineView and render a plain HStack so SwiftUI doesn't
        // schedule animation timer ticks at all. The animated branch
        // keeps its existing `chevronOpacity` contract.
        if reduceMotion {
            HStack(spacing: 4) {
                ForEach(0..<3, id: \.self) { _ in
                    Image(systemName: "chevron.right")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(KolaColors.trustGreen)
                        .opacity(0.6)
                }
            }
        } else {
            TimelineView(.animation(minimumInterval: 0.4)) { context in
                let t = context.date.timeIntervalSinceReferenceDate
                HStack(spacing: 4) {
                    ForEach(0..<3, id: \.self) { idx in
                        Image(systemName: "chevron.right")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(KolaColors.trustGreen)
                            .opacity(chevronOpacity(index: idx, time: t))
                    }
                }
            }
        }
    }

    private func chevronOpacity(index: Int, time: TimeInterval) -> Double {
        if reduceMotion { return 0.6 }
        let phase = (time.truncatingRemainder(dividingBy: 1.2)) / 1.2
        let lead = Double(index) * 0.2
        let raw = abs(sin((phase + lead) * .pi * 2))
        return 0.3 + raw * 0.5
    }

    private var thumb: some View {
        ZStack {
            Circle()
                .fill(KolaColors.trustGreen)
            Image(systemName: "arrow.right")
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(.white)
        }
        .frame(width: Self.thumbWidth, height: Self.thumbWidth)
        .padding(.horizontal, 4)
        .gesture(thumbDragGesture)
    }

    // MARK: - Gesture (U44)

    private var thumbDragGesture: some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                guard isEnabled else { return }
                let raw = value.translation.width
                dragX = max(0, min(raw, maxDrag))
            }
            .onEnded { _ in
                guard isEnabled else { return }
                let passed = dragX >= maxDrag * Self.confirmThreshold
                if passed {
                    // Snap to right edge, fire confirm.
                    withAnimation(KolaMotion.snap(reduce: reduceMotion)) {
                        dragX = maxDrag
                    }
                    onConfirm()
                } else {
                    // Spring back.
                    withAnimation(KolaMotion.snap(reduce: reduceMotion)) {
                        dragX = 0
                    }
                }
            }
    }

    // MARK: - Geometry helpers

    private var maxDrag: CGFloat {
        // Thumb has 4pt of horizontal padding inside the track, so the
        // travel distance subtracts thumb width + 2× pad.
        max(0, pillWidth - Self.thumbWidth - 8)
    }

    private var currentDragX: CGFloat {
        if let override = dragOverride { return min(override, maxDrag) }
        return dragX
    }
}
