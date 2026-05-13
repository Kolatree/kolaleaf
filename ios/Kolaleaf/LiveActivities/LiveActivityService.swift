// LiveActivityService.swift  (Phase 10B · U71 → Phase 10C iter-1 ·
//                              CA-2001 / CA-2007 / CA-2004 /
//                              ADV-P10B-C1 / ADV-P10B-C2 / ADV-P10B-C3 /
//                              ADV-P10B-C10)
//
// App-side wrapper around `Activity<KolaleafTransferAttributes>`. Owns
// the start / update / end lifecycle for transfer Live Activities and
// keeps a UserDefaults-backed map of `transferId → ActivityKit UUID`
// so foreground re-launch can reconcile against the OS's live list.
//
// Why an adapter sits between the service and ActivityKit: `Activity<>`
// is hard to mock under XCTest (no public init, the runtime is wired
// to a real APNs token, calls hit a singleton). The adapter protocol
// exposes the four operations we actually use — `currentActivities`,
// `request`, `update`, `end` — which lets us drive the orchestration
// from a fake in tests while the production adapter forwards to the
// real ActivityKit surface.
//
// CA-2001 (Phase 10C iter-1): the service surface speaks a service-
// layer `LiveActivityContent` DTO instead of ActivityKit's
// `ActivityContent<>`. `RealLiveActivityAdapter` is the ONLY file
// that imports ActivityKit; tests can build fakes without depending
// on the framework.
//
// Idempotency contract:
//   • `start(for:recipient:)` — if an activity already exists for
//     `transfer.id` (same `attributes.transferId`), the call updates
//     it instead of double-starting. `Activity.request` is invoked at
//     most once per (transferId, process lifetime).
//   • `apply(_:)` for a terminal status — calls `end(...)` once. Re-
//     invocations after the activity is gone are no-ops.
//   • `reconcileOnLaunch()` — drops stale UserDefaults entries whose
//     activity is no longer in `Activity.activities` (the OS killed
//     it). Survivors are re-indexed AND re-fetched against
//     `GET /api/v1/transfers/:id` (ADV-P10B-C3) so a transfer that
//     advanced to a terminal state while the app was suspended ends
//     instead of staying frozen on the lock screen.

@preconcurrency import ActivityKit
import Foundation

// MARK: - Token returned to the caller

public struct LiveActivityToken: Sendable, Equatable {
    /// ActivityKit's UUID for the started/updated activity.
    public let activityId: String
    /// Stable transfer identifier — matches `attributes.transferId`.
    public let transferId: String

    public init(activityId: String, transferId: String) {
        self.activityId = activityId
        self.transferId = transferId
    }
}

/// Sendable façade over `ActivityUIDismissalPolicy` so the service's
/// public surface doesn't drag the ActivityKit type into call sites
/// that don't import ActivityKit.
public enum ActivityKitDismissalPolicy: Sendable, Equatable {
    case immediate
    case after(TimeInterval)
    case `default`

    var ui: ActivityUIDismissalPolicy {
        switch self {
        case .immediate:       return .immediate
        case .after(let date): return .after(Date().addingTimeInterval(date))
        case .default:         return .default
        }
    }
}

// MARK: - Persistence

/// Persistence layer for the `transferId → activityId` map so cold
/// launch / scene re-foreground can reconcile against `Activity.activities`.
public protocol ActivityIdStoring: Sendable {
    func get(transferId: String) async -> String?
    func set(activityId: String, forTransferId transferId: String) async
    func remove(transferId: String) async
    func all() async -> [String: String]
}

public actor UserDefaultsActivityIdStore: ActivityIdStoring {
    private static let key = "com.kolaleaf.liveActivities.idMap.v1"
    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    private func read() -> [String: String] {
        (defaults.dictionary(forKey: Self.key) as? [String: String]) ?? [:]
    }

    private func write(_ map: [String: String]) {
        defaults.set(map, forKey: Self.key)
    }

    public func get(transferId: String) -> String? {
        read()[transferId]
    }

    public func set(activityId: String, forTransferId transferId: String) {
        var m = read()
        m[transferId] = activityId
        write(m)
    }

    public func remove(transferId: String) {
        var m = read()
        m.removeValue(forKey: transferId)
        write(m)
    }

    public func all() -> [String: String] {
        read()
    }
}

// MARK: - ActivityKit adapter

/// Thin Sendable handle for an in-flight Live Activity. Wraps either a
/// real `Activity<KolaleafTransferAttributes>` or a test fake.
///
/// CA-2001: the closure signatures take the service-layer DTO
/// (`LiveActivityContent`) and `ActivityKitDismissalPolicy` so this
/// type carries no ActivityKit symbols on its public surface. The
/// production adapter translates to `ActivityContent<>` /
/// `ActivityUIDismissalPolicy` inside the closures; tests construct
/// the handle without importing ActivityKit at all.
public struct LiveActivityHandle: Sendable {
    public let id: String
    public let transferId: String
    public let pushToken: String?
    /// Boxed update closure — captures a reference to the underlying
    /// activity so callers can push a fresh state.
    private let _update: @Sendable (LiveActivityContent) async -> Void
    private let _end: @Sendable (LiveActivityContent?, ActivityKitDismissalPolicy) async -> Void

    public init(
        id: String,
        transferId: String,
        pushToken: String?,
        update: @escaping @Sendable (LiveActivityContent) async -> Void,
        end: @escaping @Sendable (LiveActivityContent?, ActivityKitDismissalPolicy) async -> Void
    ) {
        self.id = id
        self.transferId = transferId
        self.pushToken = pushToken
        self._update = update
        self._end = end
    }

    @MainActor
    public func update(_ content: LiveActivityContent) async {
        await _update(content)
    }

    @MainActor
    public func end(_ content: LiveActivityContent?, dismissalPolicy: ActivityKitDismissalPolicy) async {
        await _end(content, dismissalPolicy)
    }
}

/// Surface the service depends on. Production wires `RealLiveActivityAdapter`
/// (forwards to ActivityKit). Tests inject `FakeLiveActivityAdapter`.
///
/// CA-2001: `request(...)` takes the service DTO so this protocol
/// carries no ActivityKit symbols. The production adapter translates
/// at the boundary.
public protocol LiveActivityAdapter: Sendable {
    func currentActivities() async -> [LiveActivityHandle]

    @MainActor
    func request(
        attributes: KolaleafTransferAttributes,
        content: LiveActivityContent
    ) async throws -> LiveActivityHandle
}

/// Production adapter — forwards to `Activity<KolaleafTransferAttributes>`.
/// CA-2001: this is the ONLY file that should import ActivityKit
/// outside of `KolaleafTransferAttributes.swift` (which owns the
/// attribute conformance) and `PushTokenSync.swift` (which subscribes
/// to `Activity.pushTokenUpdates`). The adapter translates between
/// the service-layer `LiveActivityContent` and ActivityKit's
/// `ActivityContent<>` here at the boundary.
public struct RealLiveActivityAdapter: LiveActivityAdapter {
    public init() {}

    public func currentActivities() async -> [LiveActivityHandle] {
        Activity<KolaleafTransferAttributes>.activities.map { Self.handle(for: $0) }
    }

    @MainActor
    public func request(
        attributes: KolaleafTransferAttributes,
        content: LiveActivityContent
    ) async throws -> LiveActivityHandle {
        let activity = try Activity<KolaleafTransferAttributes>.request(
            attributes: attributes,
            content: Self.toAK(content),
            pushType: .token
        )
        return Self.handle(for: activity)
    }

    /// Build a Sendable `LiveActivityHandle`. The closures look up the
    /// concrete `Activity<>` by id at invocation time rather than
    /// capturing it (`Activity<>` is non-Sendable in Swift 6 strict
    /// concurrency mode). Token is best-effort; ActivityKit delivers
    /// it asynchronously via `pushTokenUpdates`.
    private static func handle(for activity: Activity<KolaleafTransferAttributes>) -> LiveActivityHandle {
        let id = activity.id
        let transferId = activity.attributes.transferId
        let token = activity.pushToken.map { Self.hex(from: $0) }
        return LiveActivityHandle(
            id: id,
            transferId: transferId,
            pushToken: token,
            update: { content in
                guard let live = Activity<KolaleafTransferAttributes>.activities.first(where: { $0.id == id }) else {
                    return
                }
                await live.update(Self.toAK(content))
            },
            end: { content, policy in
                guard let live = Activity<KolaleafTransferAttributes>.activities.first(where: { $0.id == id }) else {
                    return
                }
                await live.end(content.map { Self.toAK($0) }, dismissalPolicy: policy.ui)
            }
        )
    }

    /// Bridge from the service-layer DTO to ActivityKit. Owned here so
    /// no other file in the project has to know about the translation.
    ///
    /// API-3004 / OO-3002 (iter-3): exposure raised from `private` to
    /// `internal` so `RealLiveActivityAdapterTests` can lock the
    /// round-trip contract for every `LiveActivityContent` field. If a
    /// future field (e.g. `relevanceScore`, `alertConfiguration`) is
    /// added to `LiveActivityContent`, the round-trip test fails
    /// loudly until this translator is updated.
    static func toAK(
        _ content: LiveActivityContent
    ) -> ActivityContent<KolaleafTransferAttributes.ContentState> {
        ActivityContent(state: content.state, staleDate: content.staleDate)
    }

    static func hex(from data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }
}

// MARK: - Service

@MainActor
public final class LiveActivityService {

    private let stateMap: any LiveActivityStateMapping
    private let store: any ActivityIdStoring
    private let adapter: any LiveActivityAdapter
    private let eta: any ETAProvider
    /// ADV-P10B-C3: optional API surface used by `reconcileOnLaunch`
    /// to re-fetch the current backend status of survivor activities
    /// so a transfer that advanced to a terminal state while the app
    /// was suspended ends instead of staying frozen on the lock
    /// screen. nil-safe so previews / tests that don't care about
    /// reconcile-time refetch can still construct the service.
    private let api: (any AuthAPI)?
    private let now: @Sendable () -> Date

    /// Per-transferId in-memory cache of the last issued handle so we
    /// don't have to re-scan `currentActivities()` on every update.
    /// Reconciliation refreshes this on launch.
    private var handles: [String: LiveActivityHandle] = [:]
    /// Per-transferId guard so `apply(...)` for a terminal status calls
    /// `end(...)` exactly once even if invoked multiple times.
    ///
    /// ADV-P10C-S2 (iter-3): bounded to `endedTransferIdsCap` entries
    /// via FIFO eviction so a multi-day process lifetime can't grow
    /// the set unboundedly. `endedTransferIdsOrder` carries the
    /// insertion order; mutate via `markEnded(_:)` / `unmarkEnded(_:)`
    /// so the two structures stay coherent.
    private var endedTransferIds: Set<String> = []
    private var endedTransferIdsOrder: [String] = []
    private static let endedTransferIdsCap = 256
    /// Per-transferId in-flight grace timer (CA-2005). When a transfer
    /// reaches `.completed` we end the activity after a 60-second grace
    /// so the user sees the green check. Multiple back-to-back COMPLETED
    /// pushes used to spawn competing detached Tasks; tracking them by
    /// transferId lets us cancel the previous one before scheduling the
    /// next, and lets `end(...)` / `endAllActivities()` cancel pending
    /// timers on logout.
    private var graceTasks: [String: Task<Void, Never>] = [:]
    /// ADV-P10B-C1 + ADV-P10C-C2 (iter-2): per-transferId in-flight
    /// `start(...)` Task. The first caller stores its Task here so
    /// concurrent siblings can `await task.value` directly — they see
    /// the same token on success AND see the same throw on failure.
    /// The earlier `Set<String>` + `waitForStart` polling missed both
    /// "first caller errored" and "first caller returned nil"
    /// signals, leaving siblings stranded.
    private var inFlightStarts: [String: Task<LiveActivityToken?, Error>] = [:]
    /// ADV-P10C-C3 (iter-2): set when `endAllActivities()` is in
    /// progress. A `start(...)` whose `adapter.request(...)` resumes
    /// after `endAllActivities` snapshotted state checks this flag
    /// and ends the just-created activity immediately rather than
    /// stranding it on the lock screen for the next user.
    private var isTerminating: Bool = false

    public init(
        stateMap: any LiveActivityStateMapping = LiveActivityStateMap.shared,
        store: any ActivityIdStoring = UserDefaultsActivityIdStore(),
        adapter: any LiveActivityAdapter = RealLiveActivityAdapter(),
        eta: any ETAProvider = DefaultETAProvider(),
        api: (any AuthAPI)? = nil,
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.stateMap = stateMap
        self.store = store
        self.adapter = adapter
        self.eta = eta
        self.api = api
        self.now = now
    }

    // MARK: - Public surface

    /// Start a Live Activity for a transfer. Idempotent: if an activity
    /// already exists for `transfer.id`, updates it instead of starting
    /// a second one. Returns the handle's `(activityId, transferId)`,
    /// or `nil` when the status carries no Live Activity surface (e.g.
    /// `.created` / `.unknown` / terminal). OO-2007 + API-2002: the
    /// nil return replaces the earlier empty-string-activityId sentinel
    /// so call sites must explicitly handle "nothing to start" instead
    /// of receiving a token whose `activityId` was the empty string.
    ///
    /// ADV-P10B-C1 + ADV-P10C-C2 (iter-2): concurrent `start(...)`
    /// calls for the same transferId share a single in-flight Task.
    /// The first caller installs the Task; siblings `await
    /// task.value`. Both success (LiveActivityToken?) and failure
    /// (thrown error) propagate to every concurrent sibling.
    ///
    /// ADV-P10C-C3 (iter-2): if `endAllActivities()` is in progress
    /// when `adapter.request(...)` resumes, the freshly-created
    /// activity is ended immediately so logout cannot strand a
    /// just-started activity on the lock screen for the next user.
    @discardableResult
    public func start(for transfer: TransferShape, recipient: Recipient) async throws -> LiveActivityToken? {
        if let existingTask = inFlightStarts[transfer.id] {
            // Sibling caller — wait for the first caller's Task to
            // complete. `value` rethrows the original error if the
            // first caller's `adapter.request(...)` threw.
            return try await existingTask.value
        }

        let task: Task<LiveActivityToken?, Error> = Task { [recipient] in
            try await self.performStart(for: transfer, recipient: recipient)
        }
        inFlightStarts[transfer.id] = task
        defer { inFlightStarts.removeValue(forKey: transfer.id) }
        return try await task.value
    }

    /// Body of `start(...)` extracted so the in-flight Task can wrap
    /// it once and siblings share the result. NEVER call this
    /// directly — always go through `start(for:recipient:)` which
    /// owns the dedup contract.
    ///
    /// OO-3001 (iter-3): orchestration only — band resolution and
    /// content construction live in `resolveBand(for:)` and
    /// `buildContent(status:recipientName:band:)`.
    private func performStart(for transfer: TransferShape, recipient: Recipient) async throws -> LiveActivityToken? {
        let attributes = KolaleafTransferAttributes(
            transferId: transfer.id,
            recipientName: recipient.fullName,
            recipientCurrency: "NGN",
            audAmount: transfer.sendAmount,
            ngnAmount: transfer.receiveAmount ?? "",
            exchangeRate: transfer.exchangeRate
        )

        guard let band = resolveBand(for: transfer.status) else {
            // Pre-AWAITING_AUD or terminal — there is nothing to start.
            // Caller should drive the activity once the backend
            // transitions the transfer to a renderable band.
            return nil
        }
        let content = buildContent(
            status: transfer.status,
            recipientName: recipient.fullName,
            band: band
        )

        // Idempotency: scan currentActivities for an existing one and
        // update instead of double-starting.
        if let existing = await findExistingHandle(transferId: transfer.id) {
            await existing.update(content)
            handles[transfer.id] = existing
            await store.set(activityId: existing.id, forTransferId: transfer.id)
            return LiveActivityToken(activityId: existing.id, transferId: transfer.id)
        }

        let handle = try await adapter.request(attributes: attributes, content: content)

        // ADV-P10C-C3: if `endAllActivities()` is in progress
        // (logout fired while we were awaiting ActivityKit), end the
        // just-created activity immediately rather than storing it.
        // `endAllActivities` already snapshotted state before we
        // wrote, so the safety net depends on this check.
        if isTerminating {
            await handle.end(nil, dismissalPolicy: .immediate)
            return nil
        }

        handles[transfer.id] = handle
        await store.set(activityId: handle.id, forTransferId: transfer.id)
        // A fresh start cancels any previous "ended" guard for this id
        // so a re-started transfer can complete cleanly later.
        unmarkEnded(transfer.id)
        return LiveActivityToken(activityId: handle.id, transferId: transfer.id)
    }

    /// Apply a backend status update. Routes to `Activity.update(...)`
    /// or `Activity.end(...)` per the `LiveActivityStateMap` table.
    ///
    /// ADV-P10B-C2: COMPLETED schedules the 60s grace dismissal ONLY
    /// after `pushUpdate(...)` confirms it found a handle and pushed
    /// the update. An apply-without-prior-start is now a no-op end-
    /// to-end — no orphan grace timer firing a `.end` against a
    /// non-existent activity.
    public func apply(_ transfer: TransferShape, recipientName: String = "") async {
        switch stateMap.action(for: transfer.status) {
        case .update(let band):
            let pushed = await pushUpdate(
                transferId: transfer.id,
                band: band,
                status: transfer.status,
                recipientName: recipientName
            )
            // COMPLETED gets a 60-second grace so the user sees the
            // green check before the activity disappears (per spec).
            // ADV-P10B-C2: ONLY schedule grace when pushUpdate
            // actually found a handle and updated — otherwise grace
            // would race on a non-existent activity.
            if transfer.status == .completed && pushed {
                await endAfterGrace(transferId: transfer.id, seconds: 60)
            }
        case .end:
            await end(transferId: transfer.id, dismissalPolicy: .immediate)
        case .ignore:
            return
        }
    }

    /// Force-end the activity for `transferId`. Idempotent — second
    /// call is a no-op. Used by the deeplink "dismiss" flow + on logout.
    /// CA-2005: also cancels any in-flight grace timer for this id so
    /// an explicit end (e.g. logout) doesn't race a pending grace
    /// dismissal.
    public func end(transferId: String, dismissalPolicy: ActivityKitDismissalPolicy = .default) async {
        // Cancel any pending grace timer first, regardless of the
        // ended-guard. A grace task scheduled by an earlier COMPLETED
        // push is now superseded by an explicit end.
        graceTasks.removeValue(forKey: transferId)?.cancel()

        guard !endedTransferIds.contains(transferId) else { return }
        markEnded(transferId)

        let handle: LiveActivityHandle?
        if let cached = handles[transferId] {
            handle = cached
        } else {
            handle = await findExistingHandle(transferId: transferId)
        }
        if let handle {
            await handle.end(nil, dismissalPolicy: dismissalPolicy)
        }
        handles.removeValue(forKey: transferId)
        await store.remove(transferId: transferId)
    }

    /// End every in-flight activity. Idempotent — built on `end(...)`.
    /// ADV-P10B-C10: invoked from `KolaleafApp.forceReauth()` BEFORE
    /// keychain / cookie clears so a user logging out cannot leave
    /// orphaned activities rendering on the lock screen for the next
    /// user of a shared device. Cancels every pending grace timer up
    /// front so a COMPLETED-grace can't race the immediate ends issued
    /// below.
    ///
    /// ADV-P10C-C3 (iter-2): sets `isTerminating = true` and awaits
    /// any in-flight `start(...)` Tasks so a `start` whose
    /// `adapter.request(...)` was in flight when logout fired can't
    /// strand a fresh activity. Each in-flight `start` checks
    /// `isTerminating` after `adapter.request` resumes and ends the
    /// just-created activity immediately.
    public func endAllActivities() async {
        isTerminating = true
        defer { isTerminating = false }

        // Cancel every grace timer up front so a pending COMPLETED
        // grace dismissal can't race the immediate ends we issue below.
        for (_, task) in graceTasks { task.cancel() }
        graceTasks.removeAll()

        // ADV-P10C-C3: wait for every in-flight `start(...)` Task to
        // complete before snapshotting state. The Task body sees
        // `isTerminating == true` after `adapter.request(...)` and
        // ends the freshly-created activity itself, so by the time
        // `task.value` returns, the activity is either already ended
        // (returns nil) or never reached the store. The outer loop
        // catches starts that began during our await above.
        while !inFlightStarts.isEmpty {
            let pending = Array(inFlightStarts.values)
            for task in pending { _ = try? await task.value }
        }

        // Snapshot persisted ids so iteration isn't invalidated by the
        // store mutations performed inside `end(...)`. Snapshot in-
        // memory handle ids too — the persisted map may not know
        // about handles started this session before the mapping was
        // stored.
        let persisted = await store.all()
        let inMemoryIds = Set(handles.keys)
        let allIds = inMemoryIds.union(persisted.keys)
        for transferId in allIds {
            await end(transferId: transferId, dismissalPolicy: .immediate)
        }
    }

    /// Reconcile the persisted `transferId → activityId` map against
    /// the OS's live `Activity.activities` list. Drops stale entries
    /// the OS killed while we were suspended, re-indexes survivors.
    ///
    /// ADV-P10B-C3: for each survivor activity, fetch the current
    /// transfer state from the backend and apply it. A survivor
    /// whose backend state has advanced to a terminal status while
    /// the app was suspended is ended via `apply(...)` so the lock-
    /// screen doesn't keep rendering a stale "still in flight" surface.
    public func reconcileOnLaunch() async {
        let live = await adapter.currentActivities()
        let liveByTransferId = Dictionary(uniqueKeysWithValues: live.map { ($0.transferId, $0) })

        let persisted = await store.all()
        var fresh: [String: LiveActivityHandle] = [:]
        for (transferId, _) in persisted {
            if let handle = liveByTransferId[transferId] {
                fresh[transferId] = handle
            } else if inFlightStarts[transferId] != nil {
                // ADV-P10C-C1 (iter-2): a concurrent `start(...)` is
                // mid-flight for this id. Its `adapter.request(...)`
                // hasn't resumed yet so it isn't in `liveByTransferId`,
                // but the store may or may not have its mapping (race
                // with the post-request write). Don't reap — the start
                // will publish authoritative state when it resumes.
                if let existing = handles[transferId] {
                    fresh[transferId] = existing
                }
            } else if let existing = handles[transferId] {
                // ADV-P10C-C1 (iter-2): a `start(...)` that completed
                // between our `adapter.currentActivities()` and
                // `store.all()` snapshots is in `handles` but not in
                // our `live` snapshot. The in-memory handle is
                // authoritative — keep it rather than reaping.
                fresh[transferId] = existing
            } else {
                // OS reaped the activity — drop the stale id mapping.
                await store.remove(transferId: transferId)
            }
        }
        // Also pull in any live activity the persisted map didn't know
        // about (e.g. the user started one before we ever stored the
        // mapping — defensive).
        for (transferId, handle) in liveByTransferId where fresh[transferId] == nil {
            fresh[transferId] = handle
            await store.set(activityId: handle.id, forTransferId: transferId)
        }
        handles = fresh
        // Reset ended guards for survivors so future transitions still
        // run cleanly. ADV-P10C-S2 (iter-3): trim the FIFO order array
        // to mirror the Set so the bounded structure stays coherent.
        endedTransferIds = endedTransferIds.intersection(Set(persisted.keys).subtracting(fresh.keys))
        endedTransferIdsOrder = endedTransferIdsOrder.filter { endedTransferIds.contains($0) }

        // ADV-P10B-C3: refetch each survivor's backend status. A
        // survivor whose status advanced to a terminal value while
        // the app was suspended is ended here via `apply(...)` (the
        // state-map routes terminal statuses to `.end`).
        //
        // ADV-P10C-W1 (iter-2): bound concurrency at 3 so a user with
        // a large survivor backlog doesn't fire N sequential 15-second
        // requests on cold start and compete with user-driven traffic
        // for the HTTP/2 socket. 3 is a heuristic — Apple caps Live
        // Activities at 8 concurrent per app, so N is bounded but the
        // tail of slow networks dominates cold-start time.
        guard let api else {
            #if DEBUG
            print("[LiveActivityService] reconcileOnLaunch skipped refetch — api is nil (CA-3002). \(fresh.count) survivor(s) will keep their last-known state until the next backend push.")
            #endif
            return
        }
        await withTaskGroup(of: Void.self) { group in
            var inflight = 0
            let maxConcurrent = 3
            for (transferId, _) in fresh {
                if inflight >= maxConcurrent {
                    await group.next()
                    inflight -= 1
                }
                group.addTask { [api] in
                    let result = await api.send(
                        TransfersEndpoints.Get(id: transferId),
                        origin: .system
                    )
                    if case .success(let envelope) = result {
                        await self.apply(envelope.transfer)
                    }
                }
                inflight += 1
            }
        }
    }

    // MARK: - Internals

    /// Push a content-state update to the activity for `transferId`.
    /// Returns `true` when a handle was found and `update(...)` was
    /// invoked; `false` when no activity exists for this id (e.g.
    /// `apply(...)` arrived before any `start(...)`, or the OS
    /// reaped the activity).
    ///
    /// ADV-P10B-C2: callers gate side-effects (grace timers, etc.)
    /// on the return value so an apply-without-prior-start does not
    /// schedule a phantom dismissal.
    @discardableResult
    private func pushUpdate(
        transferId: String,
        band: LiveActivityState,
        status: TransferStatus,
        recipientName: String
    ) async -> Bool {
        let resolvedHandle: LiveActivityHandle?
        if let cached = handles[transferId] {
            resolvedHandle = cached
        } else {
            resolvedHandle = await findExistingHandle(transferId: transferId)
        }
        guard let handle = resolvedHandle else {
            // Activity was never started for this id (or the OS reaped
            // it). The first AWAITING_AUD push is supposed to start one
            // via `start(for:recipient:)` — apply(...) without a prior
            // start is a no-op.
            return false
        }
        handles[transferId] = handle

        // OO-3001 (iter-3): content construction goes through the
        // shared `buildContent` helper so `performStart` and
        // `pushUpdate` can't drift on the ContentState fields they
        // populate.
        await handle.update(buildContent(
            status: status,
            recipientName: recipientName,
            band: band
        ))
        return true
    }

    private func endAfterGrace(transferId: String, seconds: TimeInterval) async {
        // CA-2005: cancel any prior grace task for this transferId
        // before scheduling a new one. Multiple back-to-back COMPLETED
        // pushes would otherwise spawn competing detached Tasks, each
        // racing to dismiss the same activity.
        graceTasks.removeValue(forKey: transferId)?.cancel()

        // Detached so the apply(...) caller doesn't await the whole
        // grace period. Using Task is fine here — MainActor isolation
        // is preserved across the await.
        let task = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            // If the task was cancelled while sleeping (logout, supersede)
            // bail before mutating state.
            guard !Task.isCancelled else { return }
            await self?.end(transferId: transferId, dismissalPolicy: .immediate)
            // `end(...)` already removed the entry from `graceTasks`,
            // but if this body raced past that removal (a second grace
            // schedule reinserted), the next scheduler will overwrite
            // it deterministically. Nothing to do here.
        }
        graceTasks[transferId] = task
    }

    // ADV-P10C-C2 (iter-2): the earlier `waitForStart` polling helper
    // was removed. Concurrent `start(...)` callers now share a single
    // Task via `inFlightStarts: [String: Task<LiveActivityToken?, Error>]`
    // and `await task.value` directly — success returns the token,
    // failure rethrows, and "no surface to start" returns nil
    // unambiguously (vs the prior conflation of nil ≡ either no
    // surface OR 1-second timeout).

    private func findExistingHandle(transferId: String) async -> LiveActivityHandle? {
        if let cached = handles[transferId] { return cached }
        let live = await adapter.currentActivities()
        return live.first { $0.transferId == transferId }
    }

    // MARK: - Pure helpers (OO-3001 / ADV-P10C-S2)

    /// Resolve a `TransferStatus` to the Live Activity band that
    /// should drive its surface. Returns `nil` for statuses that
    /// don't carry a renderable band (`.created`, `.unknown`,
    /// terminal). Pure — no I/O, no state mutation.
    private func resolveBand(for status: TransferStatus) -> LiveActivityState? {
        switch stateMap.action(for: status) {
        case .update(let band): return band
        case .end, .ignore:     return nil
        }
    }

    /// Build a `LiveActivityContent` payload from the projected
    /// fields. Used by both `performStart(...)` (fresh start) and
    /// `pushUpdate(...)` (subsequent transitions) so neither path
    /// drifts on the ContentState fields it populates. Pure —
    /// reads `eta`, `now`, and `LiveActivityStageLabels`.
    ///
    /// `staleDate: nil` matches `ActivityContent`'s "never stale"
    /// default; if/when the service surfaces a stale-after policy,
    /// it lands here at the single source of truth.
    private func buildContent(
        status: TransferStatus,
        recipientName: String,
        band: LiveActivityState
    ) -> LiveActivityContent {
        let stageLabel = LiveActivityStageLabels.label(
            for: status,
            recipientName: recipientName
        )
        let contentState = KolaleafTransferAttributes.ContentState(
            state: band,
            etaSeconds: eta.etaSeconds(for: band),
            lastUpdate: now(),
            stageLabel: stageLabel
        )
        return LiveActivityContent(state: contentState, staleDate: nil)
    }

    /// Record that `transferId`'s activity has been ended, with FIFO
    /// eviction once the bounded cap is reached. ADV-P10C-S2 (iter-3).
    /// `endedTransferIdsOrder` carries insertion order; `Set` carries
    /// the O(1) membership check. The two structures are coherent
    /// only when mutated through this helper.
    private func markEnded(_ transferId: String) {
        // Re-marking an already-ended id is a no-op (preserves the
        // earlier insertion-order position so it's not bumped to the
        // back of the FIFO queue by redundant calls).
        guard !endedTransferIds.contains(transferId) else { return }
        endedTransferIds.insert(transferId)
        endedTransferIdsOrder.append(transferId)
        while endedTransferIdsOrder.count > Self.endedTransferIdsCap {
            let evicted = endedTransferIdsOrder.removeFirst()
            endedTransferIds.remove(evicted)
        }
    }

    /// Forget that `transferId`'s activity was ended — used when
    /// a fresh `start(...)` re-opens an id that was previously
    /// terminal. Keeps `endedTransferIdsOrder` in sync with the Set.
    private func unmarkEnded(_ transferId: String) {
        guard endedTransferIds.remove(transferId) != nil else { return }
        endedTransferIdsOrder.removeAll { $0 == transferId }
    }
}
