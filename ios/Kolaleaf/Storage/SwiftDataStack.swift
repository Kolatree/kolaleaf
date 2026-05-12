// SwiftDataStack.swift  (Phase 8 · U61)
// Owns the SwiftData `ModelContainer` + a single `ModelContext`. The
// stack is constructed once per process at app startup and threaded
// through the environment as `\.swiftDataStack`.
//
// Design:
//   • Production stack uses Application Support directory (the
//     default; iOS doesn't back up Library/Application Support to
//     iCloud unless we opt-in, which we don't — these caches are
//     re-derivable from the server).
//   • Tests construct an in-memory stack via
//     `SwiftDataStack(inMemory: true)` so unit tests don't touch the
//     filesystem and don't bleed state between runs.
//   • Failures during init fall back to the in-memory stack so a
//     corrupt cache never blocks app launch. We log to stderr in
//     DEBUG so the QA loop catches it; production silently degrades
//     to "no offline cache this session".

import Foundation
import SwiftData

public final class SwiftDataStack: @unchecked Sendable {

    public let container: ModelContainer
    /// Convenience handle to the container's main-actor context. All
    /// SyncService writes go through this context.
    @MainActor public var context: ModelContext { container.mainContext }

    /// Drop every cached row from every mirrored entity. Called from
    /// `KolaleafApp.forceReauth()` so a logged-out session can't leak
    /// the previous user's recipients/transfers into the next sign-in
    /// (Phase 8 iter-2 · P2). Throws on save failure so the caller can
    /// surface the error to telemetry; the call site uses `try?` since
    /// a wipe failure should never block logout itself.
    @MainActor
    public func deleteAll() throws {
        try context.delete(model: CachedRecipient.self)
        try context.delete(model: CachedTransfer.self)
        try context.save()
    }

    /// Production initialiser. Pass `inMemory: true` from tests.
    /// `nonisolated` so the EnvironmentKey default can construct one
    /// without a MainActor hop (mirrors BankStore's pattern in
    /// Environment+Kola.swift).
    public init(inMemory: Bool = false) {
        let schema = Schema([
            CachedRecipient.self,
            CachedTransfer.self,
        ])
        let configuration = ModelConfiguration(
            schema: schema,
            isStoredInMemoryOnly: inMemory
        )
        do {
            self.container = try ModelContainer(
                for: schema,
                configurations: [configuration]
            )
        } catch {
            // Defensive: on a corrupt store, fall back to in-memory so
            // the app still launches. Subsequent foreground sync
            // refills the cache.
            #if DEBUG
            FileHandle.standardError.write(Data(
                "[SwiftDataStack] init failed, falling back to in-memory: \(error)\n"
                    .utf8
            ))
            #endif
            let memoryConfig = ModelConfiguration(
                schema: schema,
                isStoredInMemoryOnly: true
            )
            // swiftlint:disable:next force_try
            self.container = try! ModelContainer(
                for: schema,
                configurations: [memoryConfig]
            )
        }
    }
}

// MARK: - Environment wiring

import SwiftUI

private struct SwiftDataStackKey: EnvironmentKey {
    /// Default: in-memory so previews + tests that don't inject one
    /// don't accidentally write to the production sandbox.
    static let defaultValue: SwiftDataStack = SwiftDataStack(inMemory: true)
}

public extension EnvironmentValues {
    var swiftDataStack: SwiftDataStack {
        get { self[SwiftDataStackKey.self] }
        set { self[SwiftDataStackKey.self] = newValue }
    }
}
