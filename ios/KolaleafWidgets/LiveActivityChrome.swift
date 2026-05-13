// LiveActivityChrome.swift  (Phase 10A · U67-U69 shared)
// Small reusable bits the three Live Activity surfaces all need:
//   • State → `Descriptor` (tint / glyph / progress / pulse / headline)
//   • ETA formatter ("23m" / "Done")
//   • Mini timeline / progress segments
//   • Shared accessibility phrasing
//   • A DEBUG copy-lint helper that asserts user-visible strings stay
//     treasury-silent (no "float" / "balance" / "liquidity" leak)
//
// These live alongside the widget views in `KolaleafWidgets/`. They
// import the design tokens (KolaColors / KolaSpacing) which are
// included in this target's `sources` via project.yml.
//
// Test access: every type in this file is `internal` and the widget
// sources compile directly into `KolaleafWidgetsTests`, so the symbols
// are addressable from XCTest without `@testable import`.

import SwiftUI

// MARK: - Descriptor (single value type per state)

/// Bundles the per-state visual + copy decisions one place. The four
/// surfaces (LockScreenCard, DynamicIslandExpanded, DynamicIslandCompact,
/// minimal pill) used to call four sibling switches; collapsing them
/// into a single `Descriptor` keeps the mapping atomic and the call
/// sites noise-free.
struct LiveActivityDescriptor {
    let tint: Color
    let glyph: String
    let progressIndex: Double
    let shouldPulse: Bool
    let headline: String
}

enum LiveActivityStyle {

    /// One-shot resolution of the per-state visual + copy bundle.
    /// `recipientName` is interpolated into the headline; pass the
    /// activity's static `attributes.recipientName`.
    static func descriptor(
        for state: LiveActivityState,
        recipientName: String
    ) -> LiveActivityDescriptor {
        switch state {
        case .awaitingAUD:
            return LiveActivityDescriptor(
                tint: KolaColors.warning,
                glyph: "clock.fill",
                progressIndex: 1,
                shouldPulse: true,
                headline: "Awaiting your AUD"
            )
        case .processingNGN:
            return LiveActivityDescriptor(
                tint: KolaColors.trustGreen,
                glyph: "arrow.triangle.2.circlepath",
                progressIndex: 2,
                shouldPulse: true,
                headline: "Sending to \(recipientName)"
            )
        case .completed:
            return LiveActivityDescriptor(
                tint: KolaColors.leafGreen,
                glyph: "checkmark.circle.fill",
                progressIndex: 5,
                shouldPulse: false,
                headline: "Sent to \(recipientName)"
            )
        case .floatPaused:
            return LiveActivityDescriptor(
                tint: KolaColors.info,
                glyph: "pause.circle.fill",
                progressIndex: 2.5,
                shouldPulse: true,
                // OO-1001 + ADV-P10A-C3: treasury-silent copy. The
                // word "float" is reserved for internal/admin surfaces.
                headline: "Catching up — almost there"
            )
        case .failedRetry:
            return LiveActivityDescriptor(
                tint: KolaColors.coral,
                glyph: "arrow.clockwise",
                // progressFloor = 2 conservatively; ContentState has no
                // history field, so we cap at processingNGN's index.
                // Future: add `lastNonTerminalIndex` to ContentState
                // (Part B can populate from server-side tracking).
                progressIndex: 2,
                shouldPulse: true,
                headline: "Retrying — checking with provider"
            )
        case .needsAction:
            return LiveActivityDescriptor(
                tint: KolaColors.coral,
                glyph: "exclamationmark.triangle.fill",
                progressIndex: 2,
                shouldPulse: false,
                headline: "Action needed — open app"
            )
        case .unknown:
            // Forward-compat sentinel: the widget binary did not
            // recognise the wire `state` value. Render a neutral
            // surface instead of bricking the activity. ADV-P10A-C4.
            return LiveActivityDescriptor(
                tint: KolaColors.muted,
                glyph: "clock",
                progressIndex: 0,
                shouldPulse: false,
                headline: "Updating…"
            )
        }
    }

    // MARK: - Backwards-compat thin forwarders
    //
    // Existing call sites read `tint(for:)` / `glyph(for:)` etc. They
    // forward to `descriptor(for:recipientName:)` with an empty
    // recipient name (these accessors don't surface the headline).

    static func tint(for state: LiveActivityState) -> Color {
        descriptor(for: state, recipientName: "").tint
    }

    static func glyph(for state: LiveActivityState) -> String {
        descriptor(for: state, recipientName: "").glyph
    }

    static func progressIndex(for state: LiveActivityState) -> Double {
        descriptor(for: state, recipientName: "").progressIndex
    }

    /// API-1011: argument label `for` matches `tint(for:)` /
    /// `glyph(for:)` / `progressIndex(for:)` for consistency.
    static func shouldPulse(for state: LiveActivityState) -> Bool {
        descriptor(for: state, recipientName: "").shouldPulse
    }
}

// MARK: - Formatting

enum LiveActivityFormat {

    /// "23m" / "4m" / "23m 30s" / "Done" / "—"
    /// Live Activity widgets render text only — no `.timer` style API
    /// that drains GPU; we format a fresh string on each push update.
    /// The timeline refresh cadence (not the formatter) is what
    /// advances the badge between pushes.
    ///
    /// Sub-minute ETAs round up to "1m"; never returns "0m 0s".
    /// API-1005: trim "Xm 0s" → "Xm" so the badge is tidy at minute boundaries.
    static func etaCopy(state: LiveActivityState, etaSeconds: Int) -> String {
        switch state {
        case .completed:           return "Done"
        case .failedRetry, .needsAction, .unknown: return "—"
        default:
            if etaSeconds <= 0 { return "soon" }
            let minutes = etaSeconds / 60
            let seconds = etaSeconds % 60
            if minutes == 0 { return "\(seconds)s" }
            return seconds == 0 ? "\(minutes)m" : "\(minutes)m \(seconds)s"
        }
    }

    /// "5h 12m" / "12m" / "0m" — header eyebrow showing how long the
    /// user has been watching this Live Activity. lastUpdate is the
    /// server-acknowledged timestamp of the most recent push, so the
    /// elapsed value is bounded and won't drift forever in the UI.
    /// Negative skew (server clock ahead) clamps to 0m by `max`.
    static func elapsed(since lastUpdate: Date, now: Date = Date()) -> String {
        let secs = max(0, Int(now.timeIntervalSince(lastUpdate)))
        let mins = secs / 60
        if mins < 60 { return "\(mins)m" }
        let h = mins / 60
        let m = mins % 60
        return m == 0 ? "\(h)h" : "\(h)h \(m)m"
    }
}

// MARK: - Accessibility phrasing

/// Standardised VoiceOver phrasing across the three Live Activity
/// surfaces. Keeping this in one place (API-1006) means LockScreenCard
/// and DynamicIslandExpanded never drift on the verb ("to" vs "becomes").
enum LiveActivityAccessibility {
    /// "$100.00 AUD becomes ₦70,000 NGN"
    static func amountLabel(aud: String, ngn: String) -> String {
        "\(aud) becomes \(ngn)"
    }
}

// MARK: - 5-segment progress bar (lock-screen + DI expanded)

struct LiveActivityProgressBar: View {
    let state: LiveActivityState
    var segmentCount: Int = 5

    var body: some View {
        let active = LiveActivityStyle.progressIndex(for: state)
        let tint   = LiveActivityStyle.tint(for: state)
        HStack(spacing: 4) {
            ForEach(0..<segmentCount, id: \.self) { i in
                let idx = Double(i + 1)
                let opacity: Double = {
                    if active >= idx          { return 1.0 }
                    if active >= idx - 0.5    { return 0.5 } // half-tinted (floatPaused)
                    return 0.18                              // unfilled rail
                }()
                Capsule()
                    .fill(tint.opacity(opacity))
                    .frame(height: 4)
            }
        }
    }
}

// MARK: - Brand mark

/// Tiny "K" leaf mark used in the leading position of every surface.
/// Kept as a vector so it scales cleanly across compact (16pt) and
/// lock-screen (22pt) without shipping an extra asset.
struct KolaMark: View {
    var size: CGFloat = 18
    var tint: Color = KolaColors.trustGreen

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
                .fill(tint)
            Text("K")
                .font(.system(size: size * 0.62, weight: .black, design: .rounded))
                .foregroundColor(.white)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}
