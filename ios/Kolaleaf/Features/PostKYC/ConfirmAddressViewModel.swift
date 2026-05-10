// ConfirmAddressViewModel.swift  (Phase 3 · U30)
// Drives the PostKYC "Confirm Address" screen. Two modes:
//   • `isAtPrefilledAddress` true (default after load) — fields show
//     the AU address that came back from `/account/me` and are read-
//     only. Save sends the same values back so the column timestamps
//     update without changing data (idempotent).
//   • `isAtPrefilledAddress` false — fields clear and become editable.
//     The user enters a new address; inline validation blocks save
//     until the required fields parse.
//
// The view model intentionally sends ALL six address fields on save
// (even unchanged ones) so partial edits don't leave stale columns
// behind. The backend's `NullableIdentityString` transform handles
// blank→NULL on the wire.
//
// API-005 fix: `stillLiveHere` was an opaque predicate name that read
// like a question; renamed to `isAtPrefilledAddress` for clarity. The
// single `setStillLiveHere(_:)` setter that did two completely
// different things (restore prefilled values OR clear inputs) is now
// two named methods: `confirmAddressUnchanged()` and
// `startEditingNewAddress()` — each documents what it does.
//
// API-004 fix: `save()` now returns `Bool` so the View can branch on
// success and avoid calling `onContinue` after a failed save.
//
// CA-003: previously took an `AppState` parameter that was never read
// (no AppState mutation happens on this screen — addresses don't
// surface in the home/nav). The dead dependency is removed; the VM
// now constructs from `api` alone.
//
// OO-003: `lastLoaded` was an inline 5-tuple — opaque at every read
// site and impossible to extend without touching every caller. Now a
// named `LoadedAddress` struct co-located with the VM.
//
// API-009: `error: String?` upgraded to `lastError: SaveError?`. The
// View can branch on case identity (e.g. dismiss the sheet on
// `.sessionExpired`, show a retry timer on `.rateLimited`) instead of
// matching on a free-form string. The display string lives on the
// type itself (`SaveError.displayMessage`).
//
// API-010: country literal `"AU"` replaced with
// `Corridor.current.countryCode` so the next corridor (SG-NGN, UK-NGN)
// becomes a one-line change in `Corridor.swift`.

import Foundation
import Observation

@MainActor
@Observable
public final class ConfirmAddressViewModel {

    public enum Field: Hashable, Sendable {
        case addressLine1, addressLine2, city, state, postcode
    }

    /// OO-003: snapshot of the values returned by the most recent
    /// `/account/me` GET. Holding it as a named struct (instead of an
    /// inline 5-tuple) keeps the read sites self-documenting and lets
    /// us extend the snapshot in one place if a future column joins
    /// the address surface.
    private struct LoadedAddress {
        let addressLine1: String
        let addressLine2: String
        let city: String
        let state: AUState
        let postcode: String
    }

    // MARK: - Public state

    public var addressLine1: String = ""
    public var addressLine2: String = ""
    public var city: String = ""
    public var state: AUState = .nsw
    public var postcode: String = ""

    /// True when the user has confirmed they still live at the address
    /// we already have on file. The View renders the read-only
    /// `AustralianStateLabel` and disables the text inputs in this
    /// state.
    public private(set) var isAtPrefilledAddress: Bool = true

    public private(set) var isLoading: Bool = false
    public private(set) var isSaving: Bool = false
    /// API-009: typed error so the View can branch on case identity.
    /// Read `lastError?.displayMessage` for the banner copy.
    public private(set) var lastError: SaveError?
    public private(set) var validationErrors: [Field: String] = [:]

    // MARK: - Private

    private let api: AuthAPI
    /// OO-003: server snapshot used to restore the form when the user
    /// confirms they're still at the prefilled address without
    /// re-fetching `/account/me`.
    private var lastLoaded: LoadedAddress?

    public init(api: AuthAPI) {
        self.api = api
    }

    // MARK: - Lifecycle

    public func load() async {
        isLoading = true
        lastError = nil
        defer { isLoading = false }

        let result = await api.send(AccountEndpoints.Me())
        switch result {
        case .success(let me):
            addressLine1 = me.addressLine1 ?? ""
            addressLine2 = me.addressLine2 ?? ""
            city = me.city ?? ""
            state = AUState(rawValue: me.state ?? "") ?? .nsw
            postcode = me.postcode ?? ""
            lastLoaded = LoadedAddress(
                addressLine1: addressLine1,
                addressLine2: addressLine2,
                city: city,
                state: state,
                postcode: postcode
            )
            isAtPrefilledAddress = true
        case .failure(let err):
            lastError = SaveError.from(
                err,
                fallback: "Couldn't load your address. Please try again."
            )
        }
    }

    /// User toggled "I still live here" ON. Restores the prefilled
    /// values so the read-only display matches the row on file.
    public func confirmAddressUnchanged() {
        isAtPrefilledAddress = true
        if let snapshot = lastLoaded {
            addressLine1 = snapshot.addressLine1
            addressLine2 = snapshot.addressLine2
            city = snapshot.city
            state = snapshot.state
            postcode = snapshot.postcode
        }
        validationErrors.removeAll()
    }

    /// User toggled "I still live here" OFF. Clears the editable
    /// inputs so the user can type a new address. Leaves `state`
    /// alone — the picker always needs a valid AUState; clearing to
    /// nil would force a separate optional representation and
    /// complicate the View binding.
    public func startEditingNewAddress() {
        isAtPrefilledAddress = false
        addressLine1 = ""
        addressLine2 = ""
        city = ""
        postcode = ""
        validationErrors.removeAll()
    }

    /// Returns `true` if the address was persisted successfully (so
    /// the View can advance to the next step). Returns `false` on a
    /// validation failure or API error.
    @discardableResult
    public func save() async -> Bool {
        validationErrors = validate()
        guard validationErrors.isEmpty else { return false }

        isSaving = true
        lastError = nil
        defer { isSaving = false }

        let body = PatchMeBody(
            addressLine1: addressLine1.trimmingCharacters(in: .whitespacesAndNewlines),
            addressLine2: addressLine2.trimmingCharacters(in: .whitespacesAndNewlines),
            city: city.trimmingCharacters(in: .whitespacesAndNewlines),
            state: state.rawValue,
            // Postcode trimmed for parity with every other text field —
            // the View filters input to digits but a paste-then-trim
            // race could otherwise leak whitespace.
            postcode: postcode.trimmingCharacters(in: .whitespacesAndNewlines),
            // API-010: corridor-driven country code. Switching to
            // SG/UK becomes a one-line edit in `Corridor.swift`.
            country: Corridor.current.countryCode
        )
        let result = await api.send(AccountEndpoints.PatchMe(body))
        switch result {
        case .success:
            // No CurrentUserStore mutation: address isn't surfaced on
            // the home/nav surfaces, so there's nothing to update on
            // the local cache. A future Statements/Compliance screen
            // that reads address can re-fetch /account/me on appear.
            return true
        case .failure(let err):
            lastError = SaveError.from(
                err,
                fallback: "Couldn't save your address. Please try again."
            )
            return false
        }
    }

    // MARK: - Validation

    // ASCII-only \d{4}. NSRegularExpression's `\d` matches Unicode
    // category Nd (Bengali "১২৩৪", Arabic "٤", Devanagari "४") by
    // default — which would let a non-ASCII postcode reach the backend
    // even though the View input filter only accepts `Character.isNumber`
    // (also Unicode-Nd-permissive). Locking to `[0-9]{4}` here makes
    // the client-side guard match the backend's `Postcode = /^\d{4}$/`
    // primitive, which is JS RegExp `\d` — ASCII-only.
    private static let postcodeRegex = try! NSRegularExpression(
        pattern: #"^[0-9]{4}$"#
    )

    private func validate() -> [Field: String] {
        var errors: [Field: String] = [:]
        let line1 = addressLine1.trimmingCharacters(in: .whitespacesAndNewlines)
        if line1.isEmpty {
            errors[.addressLine1] = "Street address is required"
        }
        let trimmedCity = city.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedCity.isEmpty {
            errors[.city] = "City is required"
        }
        let trimmedPostcode = postcode.trimmingCharacters(in: .whitespacesAndNewlines)
        let range = NSRange(trimmedPostcode.startIndex..., in: trimmedPostcode)
        if Self.postcodeRegex.firstMatch(in: trimmedPostcode, options: [], range: range) == nil {
            errors[.postcode] = "Postcode must be 4 digits"
        }
        return errors
    }
}
