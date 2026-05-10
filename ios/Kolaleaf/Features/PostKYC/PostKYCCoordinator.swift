// PostKYCCoordinator.swift  (Phase 3 · U32)
// Routes the user through the two PostKYC screens (Confirm Profile,
// Confirm Address) after Sumsub clears KYC, then hands control back to
// the caller's `onComplete` handler. The caller (RootCoordinator in a
// later phase) advances to MainTabView from there.
//
// Two-layer architecture, mirroring `OnboardingCoordinator` /
// `OnboardingTransition`:
//   • `PostKYCFlowState` — pure value type for the navigation step.
//     Tested in isolation. No SwiftUI dependencies.
//   • `PostKYCViewModelCache` — owns the two view models so navigation
//     pop/push doesn't recreate them and lose in-flight state. Tested
//     via reference-equality.
//   • `PostKYCCoordinator` — the SwiftUI host. Composes the above onto
//     a NavigationStack.
//
// CA-003: the cache stores a `CurrentUserStore` (the protocol) and
// passes it to ConfirmProfileViewModel; ConfirmAddressViewModel no
// longer needs any user-store dependency at all (its CA-003 finding
// removed the unused `appState` parameter).
//
// ADV-12: the SwiftUI host pins `.id(store.currentUser?.id ??
// "anonymous")` to the NavigationStack. SwiftUI rebuilds the
// coordinator tree when the identity changes, which forces a fresh
// `PostKYCViewModelCache` for the new user. Without this, the
// `@State` cache would survive a logout/login on a shared device and
// user A's address could leak into user B's session.

import SwiftUI

/// Navigation step in the PostKYC flow.
public enum PostKYCStep: Hashable, Sendable {
    case profile
    case address
}

/// Pure value type backing the coordinator's navigation. All mutators
/// are deterministic so the unit tests can assert behaviour without
/// constructing a SwiftUI hierarchy.
public struct PostKYCFlowState: Equatable, Sendable {
    public private(set) var step: PostKYCStep = .profile
    public private(set) var isComplete: Bool = false

    public init() {}

    public mutating func advanceFromProfile() {
        step = .address
    }

    public mutating func advanceFromAddress() {
        isComplete = true
    }

    /// Pop from address back to profile. Clears any prior `isComplete`
    /// flag (the user is no longer at the terminal state). From
    /// `.profile` it's a no-op — there's nowhere further to pop.
    /// API-006: renamed from `back()` so the verb matches the
    /// `advanceFromX` / `goBackFromX` family used elsewhere in the
    /// flow state.
    public mutating func goBackFromAddress() {
        switch step {
        case .profile:
            return
        case .address:
            step = .profile
            isComplete = false
        }
    }
}

/// Holds the two view models for the PostKYC flow so the coordinator
/// reuses them across navigation pushes/pops. SwiftUI's `@State` would
/// not survive a pop because the destination view is rebuilt every
/// time the route is rendered; the cache is owned at the coordinator
/// scope so both views see the same instance throughout the flow.
@MainActor
public final class PostKYCViewModelCache {

    private let api: AuthAPI
    private let store: any CurrentUserStore
    private var _profile: ConfirmProfileViewModel?
    private var _address: ConfirmAddressViewModel?

    public init(api: AuthAPI, store: any CurrentUserStore) {
        self.api = api
        self.store = store
    }

    public func profileVM() -> ConfirmProfileViewModel {
        if let existing = _profile { return existing }
        let vm = ConfirmProfileViewModel(api: api, store: store)
        _profile = vm
        return vm
    }

    public func addressVM() -> ConfirmAddressViewModel {
        if let existing = _address { return existing }
        // CA-003: ConfirmAddress no longer needs a user store —
        // address fields don't reflect into AppState.
        let vm = ConfirmAddressViewModel(api: api)
        _address = vm
        return vm
    }
}

/// SwiftUI host for the PostKYC two-step flow. Caller supplies an
/// `onPostKYCComplete` handler that runs after the user finishes
/// Confirm Address. API-004: the parameter name now telegraphs the
/// terminal event so the call site is unambiguous
/// (`PostKYCCoordinator(onPostKYCComplete: { … })`). The coordinator
/// itself does not advance any global state — the caller
/// (RootCoordinator in a later phase) is responsible for the hand-off
/// to MainTabView.
///
/// `onPostKYCComplete` is wired to `ConfirmAddressView.onContinue`,
/// which only fires after `vm.save()` returns `true` — a failed save
/// can NEVER reach this handler.
@MainActor
public struct PostKYCCoordinator: View {

    @Environment(AppState.self) private var appState
    @Environment(\.apiClient) private var apiClient

    @State private var path: [PostKYCStep] = []
    @State private var cache: PostKYCViewModelCache?

    private let onPostKYCComplete: () -> Void

    public init(onPostKYCComplete: @escaping () -> Void) {
        self.onPostKYCComplete = onPostKYCComplete
    }

    public var body: some View {
        NavigationStack(path: $path) {
            ConfirmProfileView(
                vm: ensureCache().profileVM(),
                onContinue: { path.append(.address) }
            )
            .navigationDestination(for: PostKYCStep.self) { step in
                switch step {
                case .profile:
                    // Defensive — the root view IS profile; we never expect
                    // to push it again, but render it consistently.
                    ConfirmProfileView(
                        vm: ensureCache().profileVM(),
                        onContinue: { path.append(.address) }
                    )
                case .address:
                    ConfirmAddressView(
                        vm: ensureCache().addressVM(),
                        onContinue: onPostKYCComplete
                    )
                }
            }
        }
        // ADV-12: rebuild the entire flow when the user identity
        // changes. SwiftUI keys the NavigationStack on this id, so a
        // logout/login on the same device discards the cached view
        // models (and any in-flight edits) instead of leaking the
        // previous user's address into the new session.
        .id(appState.currentUser?.id ?? "anonymous")
    }

    /// Lazily instantiate the cache the first time the body renders.
    /// `@State` initial values cannot reference `@Environment`, so we
    /// have to defer construction to render time.
    private func ensureCache() -> PostKYCViewModelCache {
        if let existing = cache { return existing }
        let c = PostKYCViewModelCache(api: apiClient, store: appState)
        cache = c
        return c
    }
}
