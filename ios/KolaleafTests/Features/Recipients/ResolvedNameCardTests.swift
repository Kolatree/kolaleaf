// ResolvedNameCardTests.swift  (Phase 5 · U38 + U39 + U40 — Iteration 2)
// Smoke tests for the ResolveState variants. The View has no XCUI
// hosting in this suite — what we care about here is:
//
//   1. The View constructs without crashing for every variant.
//   2. The `onRetry` closure parameter is publicly accessible so the
//      View can fire it from the Retry buttons (and so we can assert
//      the closure is captured & callable here).
//
// Iteration 2: API-004 made `onRetry` REQUIRED (no longer optional)
// and `bankName` REQUIRED — the parent always knows them at the
// call site. Tests pass `{}` for variants that don't expose a Retry
// button.

import XCTest
import SwiftUI
@testable import Kolaleaf

@MainActor
final class ResolvedNameCardTests: XCTestCase {

    // MARK: - Construction smoke

    func test_init_withResolvingState_constructsView() {
        let card = ResolvedNameCard(
            state: .resolving(bankCode: "044", accountNumber: "0123456789"),
            bankName: "Access Bank",
            onRetry: {}
        )
        // Touch `body` to force the SwiftUI build closure to execute;
        // any crash inside the variant builders surfaces here.
        _ = card.body
    }

    func test_init_withResolvedState_constructsView() {
        let card = ResolvedNameCard(
            state: .resolved(
                name: "Adaeze N.",
                bankCode: "044",
                accountNumber: "0123456789"
            ),
            bankName: "Access Bank",
            onRetry: {}
        )
        _ = card.body
    }

    func test_init_withNotFoundState_constructsView() {
        let card = ResolvedNameCard(
            state: .notFound(bankCode: "044", accountNumber: "0123456789"),
            bankName: "Access Bank",
            onRetry: {}
        )
        _ = card.body
    }

    func test_init_withBankDownState_constructsView() {
        let card = ResolvedNameCard(
            state: .bankDown(
                bankCode: "044",
                accountNumber: "0123456789",
                retryAfter: nil
            ),
            bankName: "Access Bank",
            onRetry: {}
        )
        _ = card.body
    }

    func test_init_withBankDownState_andRetryAfterHint_constructsView() {
        let card = ResolvedNameCard(
            state: .bankDown(
                bankCode: "044",
                accountNumber: "0123456789",
                retryAfter: 5.0
            ),
            bankName: "Access Bank",
            onRetry: {}
        )
        _ = card.body
    }

    /// ADV5-002: the new exhausted variant must construct without
    /// crashing, and render the same amber chrome as `.bankDown`.
    func test_bankDownExhausted_rendersWithoutCrash() {
        let card = ResolvedNameCard(
            state: .bankDownExhausted(
                bankCode: "044",
                accountNumber: "0123456789"
            ),
            bankName: "Access Bank",
            onRetry: {}
        )
        _ = card.body
    }

    /// Iter-3 ADV5-IT2-008: the `.sessionExpired` variant renders as
    /// `EmptyView()`. The VM mirrors the state into its `lastError`
    /// banner, so showing a duplicate placeholder under the
    /// account-number field would just stack two near-identical
    /// messages. The card body must still construct without crashing
    /// for callers that pattern-match on the state.
    func test_init_withSessionExpired_rendersEmptyView() {
        let card = ResolvedNameCard(
            state: .sessionExpired,
            bankName: "Access Bank",
            onRetry: {}
        )
        // Body should compose without crash; behaviour assertion is
        // that no visible chrome appears (EmptyView). We can't
        // structurally inspect an opaque View, so we settle for the
        // construction smoke + the VM banner test in
        // AddRecipientViewModelTests that proves lastError is the
        // sole user-facing channel.
        _ = card.body
    }

    // MARK: - onRetry capture

    /// The View only fires `onRetry` from variants that expose a
    /// retry button, but the closure has to be both stored AND
    /// invocable. Asserting the closure round-trip catches a
    /// regression where the param gets renamed or accidentally
    /// dropped from the public init.
    func test_onRetryClosure_captured_andCallable_forNotFound() {
        var fired = 0
        let card = ResolvedNameCard(
            state: .notFound(bankCode: "044", accountNumber: "0123456789"),
            bankName: "Access Bank",
            onRetry: { fired += 1 }
        )
        card.onRetry()
        XCTAssertEqual(fired, 1)
    }

    func test_onRetryClosure_captured_andCallable_forBankDown() {
        var fired = 0
        let card = ResolvedNameCard(
            state: .bankDown(
                bankCode: "044",
                accountNumber: "0123456789",
                retryAfter: nil
            ),
            bankName: "Access Bank",
            onRetry: { fired += 1 }
        )
        card.onRetry()
        XCTAssertEqual(fired, 1)
    }

    func test_onRetryClosure_captured_andCallable_forBankDownExhausted() {
        var fired = 0
        let card = ResolvedNameCard(
            state: .bankDownExhausted(
                bankCode: "044",
                accountNumber: "0123456789"
            ),
            bankName: "Access Bank",
            onRetry: { fired += 1 }
        )
        card.onRetry()
        XCTAssertEqual(fired, 1)
    }
}
