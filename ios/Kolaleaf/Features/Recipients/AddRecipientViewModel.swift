// AddRecipientViewModel.swift  (Phase 4 · U36)
// Drives the Add Recipient screen. Composes:
//   • `RecipientResolveService` — debounced bank-account lookup.
//   • `AuthAPI` — POST /api/v1/recipients on save.
//
// Threading: `@MainActor`-isolated so View-driven setters (typing
// into the account number field, picking a bank) are safe to call
// from SwiftUI body bindings. The resolve service is also
// MainActor-isolated; the chain is consistent.
//
// Save contract: returns `Bool` so the View can branch on success
// and avoid dismissing on a failed POST. Same shape as
// ConfirmAddressViewModel.save (API-004 fix from Phase 3).
//
// `canSave` is the source of truth for the CTA enable-state. It
// requires a selected bank AND a `.resolved` resolve state — saving
// before resolve completes would persist a recipient with the
// wrong holder name (or none at all).

import Foundation
import Observation

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
    public var accountNumber: String = "" {
        didSet {
            let digitsOnly = accountNumber.filter { $0.isASCII && $0.isNumber }
            let cleaned = String(digitsOnly.prefix(10))
            if cleaned != accountNumber {
                // Cleanup pass: the raw input needed normalising.
                // ADV-010: only treat overflow (>10 digits) as
                // truncation — stripping non-digits alone is not.
                // Set the flag here, then recurse via the
                // assignment; the recursive didSet hits the "no
                // further change needed" branch below and we use
                // `oldValue` to skip the reset (otherwise the
                // recursion would clear the flag we just set).
                if digitsOnly.count > 10 { wasTruncated = true }
                accountNumber = cleaned
                return
            }
            // No-change branch. Two cases land here:
            //   1. User typed a clean value directly — reset stale
            //      truncation flag from a prior paste.
            //   2. We just bounced through the cleanup branch above
            //      to land on `cleaned`. In that case `oldValue` is
            //      the dirty raw input (>10 digits or with non-
            //      digits), so leave the flag alone.
            let cameFromCleanup = (oldValue != accountNumber)
            if !cameFromCleanup {
                wasTruncated = false
            }
            scheduleResolve()
        }
    }

    /// ADV-010: true when the most recent input contained more than
    /// 10 digits and the setter clipped to 10. The View binds an
    /// inline hint to this so the user knows characters were dropped.
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

    public init(api: AuthAPI, resolveService: RecipientResolveService) {
        self.api = api
        self.resolveService = resolveService
    }

    /// Convenience init that wires its own resolve service. Use this
    /// in production; tests inject the service directly to assert
    /// against its captured state.
    public convenience init(api: AuthAPI) {
        self.init(api: api, resolveService: RecipientResolveService(api: api))
    }

    // MARK: - Resolve plumbing

    private func scheduleResolve() {
        guard let bank = selectedBank else {
            // No bank chosen yet — keep the resolve service idle so
            // a partially-typed NUBAN doesn't show stale state.
            Task { await resolveService.resolve(bankCode: "", accountNumber: accountNumber) }
            return
        }
        Task {
            await resolveService.resolve(
                bankCode: bank.code,
                accountNumber: accountNumber
            )
        }
    }

    // MARK: - Save

    /// POST the new recipient. Returns `true` on success so the View
    /// can dismiss / pop and refresh the recipients list. Returns
    /// `false` on validation failure (no resolved name, no bank) or
    /// API error; `lastError` carries the user-facing message.
    @discardableResult
    public func save() async -> Recipient? {
        // ADV-002: double-save guard. A tab switch / double-tap / external
        // re-entry must not fire a second POST while the first is in flight.
        guard !isSaving else { return nil }
        guard let bank = selectedBank else {
            lastError = .unknown(message: "Pick a bank first.")
            return nil
        }
        // ADV-001: the resolved name MUST belong to the current
        // (bankCode, accountNumber) tuple. Without this check the user
        // can edit a digit between resolve-success and tapping Save and
        // route funds to a stranger whose name they never saw confirmed.
        guard case let .resolved(resolvedName, forBankCode, forAccountNumber) = resolveState,
              forBankCode == bank.code,
              forAccountNumber == accountNumber else {
            lastError = .detailsChangedWhileSaving
            return nil
        }

        isSaving = true
        lastError = nil
        defer { isSaving = false }

        let body = CreateRecipientBody(
            // ADV-004: ALWAYS send the resolved holder name as fullName.
            // Phase 7 NGN payout rejects NAME_MISMATCH against the bank's
            // record, and AUSTRAC requires the verified name in the audit
            // trail. The nickname field is captured locally for a future
            // pass when the backend schema grows a `nickname` column;
            // until then it must not override the verified name.
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
