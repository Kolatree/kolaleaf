// ConfirmProfileViewModel.swift  (Phase 3 · U29)
// Drives the PostKYC "Confirm Profile" screen. Two visible fields:
//   • legal name (read-only, from KYC) — surfaced via `legalName`
//   • display name (editable) — bound to `displayName`
//
// Lifecycle:
//   1. View calls `load()` on appear; reads `/account/me` and pre-fills
//      both fields. `displayName` defaults to "" when the row's column
//      is null so the editable field shows a clean placeholder, not
//      "nil".
//   2. View calls `save()` on the Continue CTA. Sends `PATCH /account/me`
//      with ONLY the `displayName` key — address fields stay untouched.
//   3. On success the local `CurrentUserStore` is updated so the rest
//      of the app reflects the new value without another GET. Legal
//      name is NEVER touched (KYC verified it; any change would
//      invalidate the AML/CTF audit chain).
//
// Display-name fallback: a blank or whitespace-only display name resolves
// to the first whitespace-separated token of `legalName` BEFORE the PATCH
// is sent, so users without a chosen name still get a sensible default
// in the rest of the app (avatars, nav, transfer summaries).
//
// CA-003: depends on `CurrentUserStore` (a narrow protocol) instead of
// the concrete `AppState`. The VM can mutate the cached current user's
// display name without touching unrelated state (kycStatus, idle
// clock, etc.), and tests substitute a `FakeCurrentUserStore` that
// records calls — no full `AppState` construction required.
//
// API-009: `error: String?` → `lastError: SaveError?`. View reads
// `vm.lastError?.displayMessage` for the banner copy and can branch
// on case identity (e.g. dismiss the modal on `.sessionExpired`).

import Foundation
import Observation

@MainActor
@Observable
public final class ConfirmProfileViewModel {

    /// KYC-verified legal name. Read-only at this surface.
    public private(set) var legalName: String = ""
    /// Editable user-chosen display name. Empty string when the row's
    /// column is null — UI binds directly to this so the placeholder
    /// shows naturally.
    public var displayName: String = ""

    public private(set) var isLoading: Bool = false
    public private(set) var isSaving: Bool = false
    /// API-009: typed error. Read `lastError?.displayMessage` for the
    /// banner copy; switch on the case for branching behaviour.
    public private(set) var lastError: SaveError?

    private let api: AuthAPI
    private let store: any CurrentUserStore

    public init(api: AuthAPI, store: any CurrentUserStore) {
        self.api = api
        self.store = store
    }

    // MARK: - Lifecycle

    public func load() async {
        isLoading = true
        lastError = nil
        defer { isLoading = false }

        let result = await api.send(AccountEndpoints.Me())
        switch result {
        case .success(let me):
            legalName = me.fullName ?? ""
            displayName = me.displayName ?? ""
        case .failure(let err):
            lastError = SaveError.from(
                err,
                fallback: String(
                    localized: "postkyc.profile.load_failed",
                    defaultValue: "Couldn't load your profile. Please try again."
                )
            )
        }
    }

    /// Returns `true` if the save succeeded so the View can advance to
    /// the next PostKYC step. `false` on any API error keeps the user
    /// on the screen with a banner.
    @discardableResult
    public func save() async -> Bool {
        isSaving = true
        lastError = nil
        defer { isSaving = false }

        let resolved = effectiveDisplayName()
        let body = PatchMeBody(displayName: resolved)
        let result = await api.send(AccountEndpoints.PatchMe(body))
        switch result {
        case .success(let me):
            // CA-003: route the mutation through the protocol so the
            // store enforces the "preserve legalName / email / phone"
            // invariant. The VM never reconstructs `CurrentUser` by
            // hand — that contract lives next to the store.
            let stored = me.displayName ?? resolved
            store.updateDisplayName(stored)
            // Keep the local field in sync with what the server stored
            // (covers the "blank-fallback" path so the UI shows the
            // resolved value too).
            displayName = stored
            return true
        case .failure(let err):
            lastError = SaveError.from(
                err,
                fallback: String(
                    localized: "postkyc.profile.save_failed",
                    defaultValue: "Couldn't save your profile. Please try again."
                )
            )
            return false
        }
    }

    // MARK: - Display-name fallback

    /// Returns `displayName` trimmed; if empty, falls back to the first
    /// whitespace-separated token of `legalName`. If both are empty
    /// returns an empty string (UI guards prevent reaching here).
    private func effectiveDisplayName() -> String {
        let trimmed = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { return trimmed }
        let firstToken = legalName
            .split(whereSeparator: { $0.isWhitespace })
            .first
            .map(String.init) ?? ""
        return firstToken
    }

    // OO-001: error→message translation lives in APIErrorPresenter /
    // SaveError so every VM uses the same mapping and only differs by
    // the fallback string passed in.
}
