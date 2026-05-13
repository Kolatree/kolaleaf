// LiveActivityContent.swift  (Phase 10C iter-1 · CA-2001)
//
// Service-layer DTO so the LiveActivityService surface (handles,
// adapter protocol, tests) does NOT have to import ActivityKit.
//
// `ActivityContent<...>` and `ActivityUIDismissalPolicy` are
// ActivityKit types. Forcing every consumer of `LiveActivityHandle`
// to `import ActivityKit` (including XCTest fakes) leaks the
// framework dependency outside the only place that legitimately
// owns it: `RealLiveActivityAdapter`. CA-2001 inverts that — the
// service speaks a Sendable DTO; the production adapter translates
// to ActivityKit at the boundary; tests build fakes without ever
// touching ActivityKit.
//
// Wire-equivalent of `ActivityContent<KolaleafTransferAttributes
// .ContentState>`: the `state` payload + an optional `staleDate`
// the OS uses to gate "stale activity" rendering.
//
// `ActivityKitDismissalPolicy` (already defined in
// `LiveActivityService.swift`) plays the same role for
// `ActivityUIDismissalPolicy`.

import Foundation

/// Sendable façade over `ActivityContent<KolaleafTransferAttributes
/// .ContentState>` so the LiveActivityService surface doesn't drag
/// the ActivityKit type into call sites that don't import
/// ActivityKit.
public struct LiveActivityContent: Sendable, Equatable {
    public let state: KolaleafTransferAttributes.ContentState
    /// Wall-clock at which the OS marks this content as stale and
    /// dims the lock-screen surface. `nil` means "never stale" —
    /// the contract matches `ActivityContent`'s default.
    public let staleDate: Date?

    public init(
        state: KolaleafTransferAttributes.ContentState,
        staleDate: Date? = nil
    ) {
        self.state = state
        self.staleDate = staleDate
    }
}
