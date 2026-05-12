// KolaPlaceholderStates.swift  (Phase 8 iter-2 · N6)
// Three placeholder views (Loading / SessionExpired / Failed) that
// Phase 8 iter-1 duplicated across Activity, Recipients, Account,
// Statements, Refer, and Help. Each feature re-implemented the same
// ProgressView+VStack+Buttons recipe; iter-2 collapses them into
// shared static factories so a copy or chrome tweak lands in one place.
//
// API:
//   KolaPlaceholder.loading()
//   KolaPlaceholder.sessionExpired(message:)
//   KolaPlaceholder.failed(title:message:onRetry:)
//
// All three return `some View` so feature code can plug them in
// directly without wrapping. The factories are non-generic by design
// — we want the same look across every screen, not divergence by VM.

import SwiftUI

@MainActor
public enum KolaPlaceholder {

    /// Centred spinner. Used on first paint.
    public static func loading() -> some View {
        ProgressView()
            .progressViewStyle(.circular)
            .tint(KolaColors.trustGreen)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// Session-expired state. The body copy is per-screen (Activity
    /// says "see your activity"; Recipients says "manage recipients"),
    /// so it ships as a parameter rather than a hard-coded string.
    public static func sessionExpired(message: String) -> some View {
        VStack(spacing: KolaSpacing.m) {
            Text("Session expired")
                .font(KolaFont.section)
                .foregroundStyle(KolaColors.textPrimary)
            Text(message)
                .font(KolaFont.row)
                .foregroundStyle(KolaColors.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, KolaSpacing.xl)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// Generic load-failure state with a Try-again CTA. The CTA is a
    /// closure rather than a navigation destination so the caller can
    /// wire `Task { await vm?.reload() }` (or whatever the equivalent
    /// retry primitive is on their VM).
    public static func failed(
        title: String,
        message: String,
        onRetry: @escaping () -> Void
    ) -> some View {
        VStack(spacing: KolaSpacing.m) {
            Text(title)
                .font(KolaFont.section)
                .foregroundStyle(KolaColors.textPrimary)
            Text(message)
                .font(KolaFont.row)
                .foregroundStyle(KolaColors.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, KolaSpacing.xl)
            Button("Try again", action: onRetry)
                .buttonStyle(.bordered)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
