// CurrentUserStore.swift  (Phase 3 · CA-003)
// Narrow protocol exposing the slice of `AppState` that the PostKYC
// view models actually need: read the current user, mutate the
// display name. View models depend on this protocol, NOT on the
// concrete `AppState`, so:
//
//   • Tests don't have to construct an `AppState` (with its
//     `UserDefaults`, launch-arg parsing, idle clock, etc.) just to
//     pass it to a VM.
//   • A future "anonymous review" surface that re-uses Confirm
//     Profile without an authenticated user can supply a no-op
//     conformance instead of mutating global state.
//   • The Liskov substitution boundary is explicit: anyone who can
//     `updateDisplayName` is a valid store. The VM cannot reach into
//     `AppState` internals it shouldn't touch (kycStatus,
//     activeTransfer, idle thresholds, …).
//
// `AppState` conforms in `AppState.swift`; the conformance there
// captures the actual mutation semantics (preserve `legalName`,
// `email`, `phone`).

import Foundation

@MainActor
public protocol CurrentUserStore: AnyObject {
    /// The currently authenticated user, if any.
    var currentUser: CurrentUser? { get }
    /// Update only the display name on the cached `currentUser`.
    /// No-op when `currentUser` is nil (anonymous flows).
    func updateDisplayName(_ name: String)
}
