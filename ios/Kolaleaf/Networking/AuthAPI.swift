// AuthAPI.swift  (Phase 1 · U20 prerequisite)
// Single-method protocol so ViewModels can be exercised in tests without
// constructing a real `URLSession`-backed `APIClient`. The production
// `APIClient` actor conforms naturally — `send(_:)` already matches.
//
// Protocol-over-concrete-type is the smallest amount of indirection that lets
// `FakeAPIClient` (test-only, in `KolaleafTests/Helpers`) substitute for the
// real client. ViewModels accept `AuthAPI`, the App injects the concrete
// `APIClient`, and tests inject the fake.

import Foundation

public protocol AuthAPI: Sendable {
    func send<E: Endpoint>(_ endpoint: E) async -> Result<E.Response, APIError>
}

extension APIClient: AuthAPI {}
