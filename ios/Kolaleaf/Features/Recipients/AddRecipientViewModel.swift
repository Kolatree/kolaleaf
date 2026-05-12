// AddRecipientViewModel.swift  (Phase 4 · U36 + Phase 5 · U40 — iteration 3)
// Drives the Add Recipient screen. Composes:
//   • `RecipientResolveService` — debounced bank-account lookup.
//   • `AuthAPI` — POST /api/v1/recipients on save.
//
// Threading: `@MainActor`-isolated so View-driven setters (typing
// into the account number field, picking a bank) are safe to call
// from SwiftUI body bindings. The resolve service is also
// MainActor-isolated; the chain is consistent.
//
// Save contract: returns `Recipient?` so the View can branch on
// success and avoid dismissing on a failed POST.
//
// `canSave` is the source of truth for the CTA enable-state. It
// requires a selected bank AND a `.resolved` resolve state — saving
// before resolve completes would persist a recipient with the
// wrong holder name (or none at all).
//
// Iteration 2 fixes (API-001, OO-103, OO-108, ADV5-008).
//
// Iteration 3 fixes:
//   • API-204 — `onSessionExpired` flows through the resolve service's
//     non-defaulted init parameter (was previously a public mutable
//     property on the service). The VM passes its own bridge closure
//     that flips `lastError`. To bridge `self` into the closure even
//     though the resolve service must be assigned before `self` is
//     fully available, the bridge captures a small `Box<…>` holder
//     and the VM threads `self` into the holder right after init.
//   • API-202 — `ResolveState` case labels lost the `for` preposition;
//     pattern-match in `save()` updated.
//   • ADV5-IT2-005 — `wasTruncated` is now re-derived per setter call
//     rather than maintaining latched state. A subsequent edit that
//     strips a non-digit no longer leaves a stale "Truncated to 10
//     digits" warning around forever.
//   • ADV5-IT2-006 — rapid bank-picker toggling no longer stacks
//     unstructured Tasks. `resolveTask` holds the current scheduling
//     Task and is cancel-then-replaced on every `scheduleResolve`.

import Foundation
import Observation

/// Small holder used to bridge `self` into a closure captured by
/// `RecipientResolveService`'s `onSessionExpired` parameter. The
/// service requires the closure at init-time (immutable thereafter);
/// the VM needs `self` to flip `lastError`. The box is captured by
/// the closure as a value, mutated to point at `self` post-init,
/// and held weakly to avoid a retain cycle.
@MainActor
private final class SessionExpiredBox {
    weak var target: AddRecipientViewModel?
    init() { self.target = nil }
}

@MainActor
@Observable
public final class AddRecipientViewModel {

    // MARK: - Public state

    /// User-picked bank from the BankPickerSheet.
    public var selectedBank: Bank? {
        didSet {
            // Re-trigger resolve if the new bank differs and we have
            // a valid account number.
            guard oldValue != selectedBank else { return }
            scheduleResolve()
        }
    }

    /// 10-digit NUBAN. Setter strips non-ASCII-digit characters and
    /// truncates to 10 so paste-then-tab can't sneak letters past
    /// the field's keyboardType filter.
    ///
    /// Iter-3 ADV5-IT2-005: `wasTruncated` is re-derived per
    /// USER-DRIVEN setter pass rather than maintaining latched state.
    /// The setter runs twice for an overflow edit (once with the raw
    /// input, recursively with `cleaned`). We must:
    ///   • Set the flag on the user-driven pass so the recursive
    ///     re-entry inherits it.
    ///   • Clear the flag on a user-driven pass that does not itself
    ///     truncate, so a subsequent non-truncating edit (typing a
    ///     letter that gets stripped) doesn't leave a stale warning.
    /// The recursive re-entry is detected by `oldValue != newValue`
    /// landing on the no-change branch — at that point, `oldValue`
    /// is the raw input and `newValue == cleaned`, so we know we
    /// came from a cleanup pass and the flag set by the outer pass
    /// must be preserved.
    public var accountNumber: String = "" {
        didSet {
            let digitsOnly = accountNumber.filter { $0.isASCII && $0.isNumber }
            let cleaned = String(digitsOnly.prefix(10))
            // Whether THIS particular setter pass truncated overflow
            // (digits beyond 10) — independent of any prior truncation.
            let overflowedThisPass = digitsOnly.count > 10
            if cleaned != accountNumber {
                // Cleanup pass: the raw input needed normalising.
                // ADV-010: only treat overflow (>10 digits) as
                // truncation — stripping non-digits alone is not.
                wasTruncated = overflowedThisPass
                accountNumber = cleaned
                return
            }
            // No-change branch — the inner pass produced the same
            // value as oldValue.
            //
            // If oldValue != accountNumber, this is the recursive
            // re-entry from the cleanup branch above; the outer
            // pass already set `wasTruncated` correctly, so we
            // PRESERVE it. Otherwise this is a user-driven set with
            // no truncation needed, and any prior latched flag
            // must clear so a non-truncating edit doesn't leave the
            // "Truncated to 10 digits" warning sticking around.
            let cameFromCleanup = (oldValue != accountNumber)
            if !cameFromCleanup {
                wasTruncated = false
            }
            scheduleResolve()
        }
    }

    /// ADV-010: true when the most recent input contained more than
    /// 10 digits and the setter clipped to 10.
    public private(set) var wasTruncated: Bool = false

    /// Optional friendly name the user can attach. Recipient list
    /// uses fullName from the resolve response when this is empty,
    /// matching the design.
    public var nickname: String = ""

    public var resolveState: ResolveState { resolveService.state }

    public private(set) var isSaving: Bool = false
    public private(set) var lastError: SaveError?

    /// CTA gating. Save is allowed only when:
    ///   • A bank is selected.
    ///   • The resolve service produced a `.resolved` state with a
    ///     non-empty holder name.
    public var canSave: Bool {
        guard selectedBank != nil else { return false }
        if case .resolved = resolveState { return true }
        return false
    }

    // MARK: - Dependencies

    private let api: AuthAPI
    private let resolveService: RecipientResolveService

    /// Iter-3 ADV5-IT2-006: the in-flight resolve scheduling task.
    /// Cancelled and replaced on every `scheduleResolve()` call so
    /// rapid picker / account-number toggling cannot stack
    /// unstructured Tasks that race against the actor's enqueue
    /// determinism.
    private var resolveTask: Task<Void, Never>?

    /// Designated init. Callers that inject their own resolve service
    /// (tests) wire the `onSessionExpired` bridge at service-
    /// construction time and pass the fully-formed service here.
    public init(api: AuthAPI, resolveService: RecipientResolveService) {
        self.api = api
        self.resolveService = resolveService
    }

    /// Convenience init that wires its own resolve service. Use this
    /// in production; tests inject the service directly.
    ///
    /// Iter-3 (API-204): the resolve service's `onSessionExpired`
    /// callback is supplied at construction time via a `SessionExpiredBox`
    /// that we re-point at `self` once the designated init completes.
    /// This preserves the service's immutable-after-construction
    /// contract without forcing the VM to keep a mutable bridge.
    public convenience init(api: AuthAPI) {
        let box = SessionExpiredBox()
        let service = RecipientResolveService(
            api: api,
            onSessionExpired: { [box] in
                box.target?.lastError = .sessionExpired
            }
        )
        self.init(api: api, resolveService: service)
        box.target = self
    }

    // MARK: - Resolve plumbing (screen-domain API names — API-001 / OO-103)

    /// Manual retry — fires when the user taps "Retry" / "Retry now"
    /// on the ResolvedNameCard. Wraps the service's `retryNow()`.
    /// The screen-domain naming reads as prose at the call site:
    /// `vm.userTappedRetry()` over `vm.retryResolve()`.
    public func userTappedRetry() {
        Task { await resolveService.retryNow() }
    }

    /// Stop firing background auto-retries. The View calls this on
    /// `scenePhase == .background` so a backgrounded app doesn't
    /// hammer the resolve endpoint while suspended.
    /// API-002: paired with `screenActivated()` — the asymmetry is
    /// intentional. Pause is cheap and idempotent; resume re-arms
    /// from the bound key.
    public func screenDeactivated() {
        resolveService.pauseAutoRetry()
    }

    /// Re-arm background auto-retries. The View calls this on
    /// `scenePhase == .active` to pick up the schedule where it left
    /// off if the current state is still `.bankDown`.
    public func screenActivated() {
        resolveService.resumeAutoRetry()
    }

    private func scheduleResolve() {
        guard let bank = selectedBank else {
            // OO-108: express the intent. The previous "send an
            // empty-bank resolve" path was a clever way to use the
            // service's existing validation gate to reset state, but
            // it read like a bug. cancelAndReset says exactly what
            // it does.
            resolveTask?.cancel()
            resolveTask = nil
            resolveService.cancelAndReset()
            return
        }
        // Iter-3 ADV5-IT2-006: cancel-then-replace the scheduling
        // Task so rapid picker / account-number toggling cannot
        // stack two-or-more concurrent resolves.
        resolveTask?.cancel()
        resolveTask = Task { [weak self] in
            guard let self else { return }
            await self.resolveService.resolve(
                bankCode: bank.code,
                accountNumber: self.accountNumber
            )
        }
    }

    // MARK: - Save

    /// POST the new recipient. Returns the saved `Recipient` on
    /// success so the View can dismiss / pop and refresh the
    /// recipients list. Returns `nil` on validation failure (no
    /// resolved name, no bank) or API error; `lastError` carries
    /// the user-facing message.
    @discardableResult
    public func save() async -> Recipient? {
        // ADV-002: double-save guard.
        guard !isSaving else { return nil }
        guard let bank = selectedBank else {
            lastError = .unknown(message: "Pick a bank first.")
            return nil
        }
        // ADV-001: the resolved name MUST belong to the current
        // (bankCode, accountNumber) tuple.
        // Iter-3 (API-202): case labels lost the `for` preposition.
        guard case let .resolved(resolvedName, bankCode, resolvedAccountNumber) = resolveState,
              bankCode == bank.code,
              resolvedAccountNumber == accountNumber else {
            lastError = .detailsChangedWhileSaving
            return nil
        }

        isSaving = true
        lastError = nil
        defer { isSaving = false }

        let body = CreateRecipientBody(
            // ADV-004: ALWAYS send the resolved holder name.
            fullName: resolvedName,
            bankName: bank.name,
            bankCode: bank.code,
            accountNumber: accountNumber
        )

        let result = await api.send(RecipientsEndpoints.Create(body))
        switch result {
        case .success(let response):
            return response.recipient
        case .failure(let err):
            lastError = SaveError.from(
                err,
                fallback: "Couldn't save the recipient. Please try again."
            )
            return nil
        }
    }
}
