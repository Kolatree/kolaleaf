// PostKYCCoordinatorTests.swift  (Phase 3 · U32)
// Tests for the PostKYC coordinator's pure transition rules. The SwiftUI
// shell composes these onto a NavigationStack but the rules themselves
// are value-only and isolated for unit-test stability — same pattern as
// `OnboardingTransitionTests`.
//
// CA-003: cache constructor now takes a `CurrentUserStore` (the
// protocol) instead of a concrete `AppState`. Tests inject a
// `FakeCurrentUserStore` so they don't have to construct `AppState`
// just to read its identity.
//
// ADV-12: lifecycle hardening — the cache is created per-user, so two
// caches built with different stores must produce independent VM
// instances (asserting the absence of accidental cross-user state
// sharing in the cache itself).

import XCTest
@testable import Kolaleaf

final class PostKYCTransitionTests: XCTestCase {

    func test_initial_isProfileStep() {
        let s = PostKYCFlowState()
        XCTAssertEqual(s.step, .profile)
    }

    func test_advance_fromProfile_movesToAddress() {
        var s = PostKYCFlowState()
        s.advanceFromProfile()
        XCTAssertEqual(s.step, .address)
    }

    func test_advance_fromAddress_setsCompleted() {
        var s = PostKYCFlowState()
        s.advanceFromProfile()
        s.advanceFromAddress()
        XCTAssertTrue(s.isComplete)
    }

    func test_goBackFromAddress_returnsToProfile_andClearsCompletedFlag() {
        var s = PostKYCFlowState()
        s.advanceFromProfile()
        s.goBackFromAddress()
        XCTAssertEqual(s.step, .profile)
        XCTAssertFalse(s.isComplete)
    }

    func test_goBackFromAddress_fromProfile_isNoOp() {
        var s = PostKYCFlowState()
        s.goBackFromAddress()
        XCTAssertEqual(s.step, .profile)
        XCTAssertFalse(s.isComplete)
    }

    // MARK: - VM caching
    //
    // The cache + VMs are MainActor-isolated; the cache tests run inside
    // a MainActor context to call them from a synchronous suite method.

    @MainActor
    func test_profileVM_isPreservedAcrossNavigation() {
        // The coordinator must keep the same VM instance after the user
        // pushes Address and pops back to Profile. Recreating the VM
        // would lose any in-flight edits the user made.
        let api = FakeAPIClient()
        let cache = PostKYCViewModelCache(api: api, store: FakeCurrentUserStore())

        let first = cache.profileVM()
        let secondAfterPush = cache.profileVM()
        XCTAssertTrue(first === secondAfterPush,
                      "profileVM() must return the same instance across calls.")
    }

    @MainActor
    func test_addressVM_isPreservedAcrossNavigation() {
        let api = FakeAPIClient()
        let cache = PostKYCViewModelCache(api: api, store: FakeCurrentUserStore())

        let first = cache.addressVM()
        let second = cache.addressVM()
        XCTAssertTrue(first === second)
    }

    // MARK: - ADV-12: per-user cache isolation
    //
    // Two caches built independently (which is what SwiftUI does when
    // `.id(currentUser?.id)` rebuilds the NavigationStack on a
    // logout/login) must yield different VM instances. Without this,
    // the previous user's address could leak into the new user's
    // session.

    @MainActor
    func test_distinctCaches_yieldDistinctVMs() {
        let api = FakeAPIClient()
        let storeA = FakeCurrentUserStore(currentUser: CurrentUser(
            id: "user-A", displayName: nil, legalName: nil, email: nil, phone: nil))
        let storeB = FakeCurrentUserStore(currentUser: CurrentUser(
            id: "user-B", displayName: nil, legalName: nil, email: nil, phone: nil))

        let cacheA = PostKYCViewModelCache(api: api, store: storeA)
        let cacheB = PostKYCViewModelCache(api: api, store: storeB)

        let aProfile = cacheA.profileVM()
        let bProfile = cacheB.profileVM()
        XCTAssertFalse(aProfile === bProfile,
                       "A new cache (per .id(...) rebuild) must produce a fresh ProfileVM.")

        let aAddress = cacheA.addressVM()
        let bAddress = cacheB.addressVM()
        XCTAssertFalse(aAddress === bAddress,
                       "A new cache (per .id(...) rebuild) must produce a fresh AddressVM.")
    }
}
