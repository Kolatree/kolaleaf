// ResolvedNameCard.swift  (Phase 5 · U37 + U38 + U39 + U40 — iteration 3)
// Renders the resolved-account-holder card under the AccountNumber
// field on AddRecipientView. Phase 4 shipped the `.resolved` variant;
// Phase 5 fills in the rest:
//
//   • U38 `.resolving` — frosted card with a small spinner and the
//     bank name passed in by the parent. Conveys "we're talking to
//     the bank, hang on" without the heavyweight full-page loader.
//   • U39 `.notFound` — coral error card. Includes the NGN-
//     irreversibility warning ("Naira transfers can't be reversed")
//     because this is the last gate before the user wires money to
//     a stranger; we want them to slow down and re-check the digits.
//   • U40 `.bankDown` — amber warn card. Auto-retry runs silently in
//     the service; this card communicates "we'll keep trying" and
//     exposes a "Retry now" affordance.
//   • Iter 2 `.bankDownExhausted` — same amber chrome as `.bankDown`
//     but the copy drops the auto-retry promise and prompts the
//     user to tap Retry now (ADV5-002).
//
// Iteration 3 fixes:
//   • API-202 — `ResolveState` case labels lost the `for` preposition;
//     pattern matches updated.
//   • ADV5-IT2-008 — `.sessionExpired` no longer renders a duplicate
//     in-form placeholder. The VM mirrors the state to its
//     `lastError` banner; the card returns `EmptyView()` to avoid
//     stacking two near-identical messages under the account-number
//     field.
//   • ADV5-IT2-011 — bank-name moved out of the error-card TITLE and
//     into the BODY. Real Nigerian banks ("Standard Chartered Bank
//     Nigeria Limited", "United Bank for Africa") were getting
//     clipped at the `.lineLimit(2)` title boundary, hiding the
//     contextual cue. Title is now a short stable phrase; the body
//     wraps freely.

import SwiftUI

public struct ResolvedNameCard: View {
    public let state: ResolveState
    /// Bank name to display in the resolving / bankDown / exhausted
    /// variants. The parent (AddRecipientView) passes either the
    /// verified `vm.selectedBank?.name` or — when the bank is
    /// unknown to the local cache — the bank code itself, so the
    /// failure mode is diagnosable instead of a vague "the bank"
    /// (API-006).
    public let bankName: String
    /// Closure fired by the Retry / Retry now buttons in the
    /// `.notFound`, `.bankDown`, and `.bankDownExhausted` variants.
    /// API-004: required (not Optional). Variants that do not render
    /// a Retry button (idle, resolving, resolved, sessionExpired)
    /// receive the closure but never invoke it; previews / tests
    /// supply `{}`.
    public let onRetry: () -> Void

    public init(
        state: ResolveState,
        bankName: String,
        onRetry: @escaping () -> Void
    ) {
        self.state = state
        self.bankName = bankName
        self.onRetry = onRetry
    }

    public var body: some View {
        switch state {
        case .idle:
            EmptyView()
        case .resolving:
            resolvingCard(bankName: bankName)
        case let .resolved(name, _, _):
            resolvedCard(name: name)
        case .notFound:
            notFoundCard()
        case .bankDown:
            bankDownCard(bankName: bankName)
        case .bankDownExhausted:
            bankDownExhaustedCard(bankName: bankName)
        case .sessionExpired:
            // Iter-3 ADV5-IT2-008: the VM surfaces sessionExpired via
            // `lastError = .sessionExpired`, which renders below the
            // form as the single channel. Showing a duplicate
            // placeholder under the account-number field was just
            // noise stacking against the banner.
            EmptyView()
        }
    }

    // MARK: - Variants

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

    /// U38 — inline spinner + "Checking with [Bank]…". Frosted card,
    /// matches the resolved variant's outer chrome so a state flip
    /// doesn't shift layout.
    private func resolvingCard(bankName: String) -> some View {
        HStack(spacing: KolaSpacing.m) {
            ProgressView()
                .progressViewStyle(.circular)
                .controlSize(.small)
                .tint(KolaColors.muted)
            Text("Checking with \(bankName)…")
                .font(KolaFont.row)
                .foregroundStyle(KolaColors.textSecondary)
            Spacer()
        }
        .padding(.horizontal, KolaSpacing.xl)
        .padding(.vertical, KolaSpacing.l)
        .kolaFrosted(.card)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Checking with \(bankName)")
    }

    /// U39 — coral error card. Body deliberately leads with the
    /// NGN-irreversibility warning so the user re-checks the digits
    /// rather than retrying blindly.
    private func notFoundCard() -> some View {
        KolaErrorCard(
            tint: KolaColors.coral,
            iconSystemName: "exclamationmark.triangle.fill",
            title: "Account not found",
            message: "Double-check the account number. Naira transfers can't be reversed if it goes to the wrong recipient.",
            retry: KolaErrorCard.RetryAction(
                label: "Retry",
                hint: "Activates a fresh account lookup.",
                perform: onRetry
            )
        )
    }

    /// U40 — amber warn card while the auto-retry timer is still
    /// scheduling further attempts. Communicates the in-progress
    /// recovery and exposes a "Retry now" affordance for users who
    /// don't want to wait.
    ///
    /// Iter-3 ADV5-IT2-011: title is a short stable phrase; the bank
    /// name moves into the body so long bank names ("Standard
    /// Chartered Bank Nigeria Limited") don't get clipped at the
    /// title's `.lineLimit(2)` boundary.
    private func bankDownCard(bankName: String) -> some View {
        KolaErrorCard(
            tint: KolaColors.warning,
            iconSystemName: "clock.arrow.circlepath",
            title: "Bank is taking longer than usual",
            message: "We're having trouble reaching \(bankName). We'll try again automatically.",
            retry: KolaErrorCard.RetryAction(
                label: "Retry now",
                hint: "Activates a fresh account lookup.",
                perform: onRetry
            )
        )
    }

    /// ADV5-002 — same amber chrome as `.bankDown` but the copy
    /// drops the auto-retry promise. The auto-retry budget is spent;
    /// the only path forward is the user tapping Retry now.
    ///
    /// Iter-3 ADV5-IT2-011: same title/body split as `bankDownCard`
    /// to keep long bank names readable.
    private func bankDownExhaustedCard(bankName: String) -> some View {
        KolaErrorCard(
            tint: KolaColors.warning,
            iconSystemName: "clock.arrow.circlepath",
            title: "Bank is still unreachable",
            message: "We're still having trouble reaching \(bankName). Tap Retry now to try again.",
            retry: KolaErrorCard.RetryAction(
                label: "Retry now",
                hint: "Activates a fresh account lookup.",
                perform: onRetry
            )
        )
    }
}
