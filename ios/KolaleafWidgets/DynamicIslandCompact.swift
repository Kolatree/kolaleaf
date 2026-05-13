// DynamicIslandCompact.swift  (Phase 10A · U67)
// Compact Dynamic Island leading + trailing regions. The system
// allocates roughly 162pt of width split between the two — leading
// gets the brand mark + state glyph, trailing gets the ETA copy.
//
// Pulse animation runs only on `inFlight` states (awaitingAUD,
// processingNGN, floatPaused, failedRetry). Once the activity reaches
// a terminal/quiescent band (.completed / .needsAction / .unknown)
// the pulse stops so users aren't drawn back to a static row.
//
// `now` is injected (default `Date()`) so snapshot tests hold the
// elapsed badge deterministic — see ADV-P10A-C6.

import SwiftUI

@MainActor
struct DynamicIslandCompact {
    let attributes: KolaleafTransferAttributes
    let state: KolaleafTransferAttributes.ContentState
    var now: Date = Date()

    /// Leading half of the compact region.
    @ViewBuilder
    var leading: some View {
        let descriptor = LiveActivityStyle.descriptor(
            for: state.state,
            recipientName: attributes.recipientName
        )
        HStack(spacing: 4) {
            KolaMark(size: 18, tint: descriptor.tint)
                .modifier(PulseModifier(active: descriptor.shouldPulse))
            Image(systemName: descriptor.glyph)
                .font(.system(size: 12, weight: .bold))
                .foregroundColor(descriptor.tint)
        }
        .padding(.leading, 4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Kolaleaf transfer to \(attributes.recipientName)")
    }

    /// Trailing half: ETA copy ("23m" / "Done").
    @ViewBuilder
    var trailing: some View {
        let tint = LiveActivityStyle.tint(for: state.state)
        let eta = LiveActivityFormat.etaCopy(state: state.state, etaSeconds: state.etaSeconds)
        Text(eta)
            .font(.system(size: 12, weight: .semibold).monospacedDigit())
            .foregroundColor(tint)
            .padding(.trailing, 4)
            .accessibilityLabel("Time remaining: \(eta)")
    }
}

// MARK: - Pulse animation

/// Soft scale + opacity pulse for the brand mark while a transfer is
/// in flight. Pure SwiftUI — no Combine timer — so the widget process
/// stays well under the ActivityKit budget.
///
/// OO-1004 + ADV-P10A-W3: react to `active` flipping at runtime.
/// Without `.onChange`, a `.processingNGN → .completed` push update
/// keeps the pulse running because `animating` was latched true on
/// initial appear and never re-read after the state changed.
private struct PulseModifier: ViewModifier {
    let active: Bool
    @State private var animating = false

    func body(content: Content) -> some View {
        content
            .scaleEffect(animating ? 1.06 : 1.0)
            .opacity(animating ? 0.85 : 1.0)
            .animation(
                active
                    ? .easeInOut(duration: 1.1).repeatForever(autoreverses: true)
                    : .default,
                value: animating
            )
            .onAppear { animating = active }
            .onChange(of: active) { _, newValue in animating = newValue }
    }
}
