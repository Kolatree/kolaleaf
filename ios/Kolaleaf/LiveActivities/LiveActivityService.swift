// LiveActivityService.swift  (Phase 10B · U71)
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
// Idempotency contract:
//   • `start(for:recipient:)` — if an activity already exists for
//     `transfer.id` (same `attributes.transferId`), the call updates
//     it instead of double-starting. `Activity.request` is invoked at
//     most once per (transferId, process lifetime).
//   • `apply(_:)` for a terminal status — calls `end(...)` once. Re-
//     invocations after the activity is gone are no-ops.
//   • `reconcileOnLaunch()` — drops stale UserDefaults entries whose
//     activity is no longer in `Activity.activities` (the OS killed
//     it). Survivors are re-indexed.

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
public struct LiveActivityHandle: Sendable {
    public let id: String
    public let transferId: String
    public let pushToken: String?
    /// Boxed update closure — captures a reference to the underlying
    /// activity so callers can push a fresh state.
    private let _update: @Sendable (ActivityContent<KolaleafTransferAttributes.ContentState>) async -> Void
    private let _end: @Sendable (ActivityContent<KolaleafTransferAttributes.ContentState>?, ActivityUIDismissalPolicy) async -> Void

    public init(
        id: String,
        transferId: String,
        pushToken: String?,
        update: @escaping @Sendable (ActivityContent<KolaleafTransferAttributes.ContentState>) async -> Void,
        end: @escaping @Sendable (ActivityContent<KolaleafTransferAttributes.ContentState>?, ActivityUIDismissalPolicy) async -> Void
    ) {
        self.id = id
        self.transferId = transferId
        self.pushToken = pushToken
        self._update = update
        self._end = end
    }

    @MainActor
    public func update(_ content: ActivityContent<KolaleafTransferAttributes.ContentState>) async {
        await _update(content)
    }

    @MainActor
    public func end(_ content: ActivityContent<KolaleafTransferAttributes.ContentState>?, dismissalPolicy: ActivityUIDismissalPolicy) async {
        await _end(content, dismissalPolicy)
    }
}

/// Surface the service depends on. Production wires `RealLiveActivityAdapter`
/// (forwards to ActivityKit). Tests inject `FakeLiveActivityAdapter`.
public protocol LiveActivityAdapter: Sendable {
    func currentActivities() async -> [LiveActivityHandle]

    @MainActor
    func request(
        attributes: KolaleafTransferAttributes,
        content: ActivityContent<KolaleafTransferAttributes.ContentState>
    ) async throws -> LiveActivityHandle
}

/// Production adapter — forwards to `Activity<KolaleafTransferAttributes>`.
public struct RealLiveActivityAdapter: LiveActivityAdapter {
    public init() {}

    public func currentActivities() async -> [LiveActivityHandle] {
        Activity<KolaleafTransferAttributes>.activities.map { Self.handle(for: $0) }
    }

    @MainActor
    public func request(
        attributes: KolaleafTransferAttributes,
        content: ActivityContent<KolaleafTransferAttributes.ContentState>
    ) async throws -> LiveActivityHandle {
        let activity = try Activity<KolaleafTransferAttributes>.request(
            attributes: attributes,
            content: content,
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
                await live.update(content)
            },
            end: { content, policy in
                guard let live = Activity<KolaleafTransferAttributes>.activities.first(where: { $0.id == id }) else {
                    return
                }
                await live.end(content, dismissalPolicy: policy)
            }
        )
    }

    static func hex(from data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }
}

// MARK: - Stage labels

/// Operational copy that names the current step of an in-flight
/// transfer. Pulled into a dedicated mapper so it can be exercised
/// against `LiveActivityCopyLint` in a single test sweep.
///
/// Treasury-internal vocabulary is forbidden — see
/// `LiveActivityCopyLint.forbidden`. The DEBUG lint asserts on every
/// returned label.
enum LiveActivityStageLabels {
    static func label(for status: TransferStatus, recipientName: String) -> String {
        let raw: String
        switch status {
        case .awaitingAud:        raw = "Waiting for your AUD"
        case .audReceived:        raw = "AUD received — locking rate"
        case .processingNgn:      raw = "Sending NGN to \(recipientName)"
        case .ngnSent:            raw = "Almost done"
        case .ngnRetry:           raw = "Retrying — checking with provider"
        case .floatInsufficient:  raw = "Hold tight — we'll resume shortly"
        case .completed:          raw = "Sent — \(recipientName) has it"
        case .ngnFailed:          raw = "Retrying — checking with provider"
        case .needsManual:        raw = "Action needed — open app"
        default:                  raw = ""
        }
        return LiveActivityCopyLint.assertNotForbidden(raw)
    }
}

/// DEBUG-only mirror of the widget's `LiveActivityCopyLint`. The
/// widget lives in a separate target so the symbol is not visible to
/// the app target — this re-declares the public surface so service
/// labels are guarded the same way.
enum LiveActivityCopyLint {
    static let forbidden: Set<String> = [
        "float", "treasury", "liquidity", "insufficient", "balance",
    ]

    @discardableResult
    @inlinable
    static func assertNotForbidden(
        _ s: String,
        file: StaticString = #file,
        line: UInt = #line
    ) -> String {
        #if DEBUG
        let lower = s.lowercased()
        for word in forbidden where lower.contains(word) {
            assertionFailure(
                "Live Activity copy contains forbidden treasury vocabulary: \"\(word)\" in \"\(s)\"",
                file: file,
                line: line
            )
            break
        }
        #endif
        return s
    }
}

// MARK: - Service

@MainActor
public final class LiveActivityService {

    private let stateMap: any LiveActivityStateMapping
    private let store: any ActivityIdStoring
    private let adapter: any LiveActivityAdapter
    private let eta: any ETAProvider
    private let now: @Sendable () -> Date

    /// Per-transferId in-memory cache of the last issued handle so we
    /// don't have to re-scan `currentActivities()` on every update.
    /// Reconciliation refreshes this on launch.
    private var handles: [String: LiveActivityHandle] = [:]
    /// Per-transferId guard so `apply(...)` for a terminal status calls
    /// `end(...)` exactly once even if invoked multiple times.
    private var endedTransferIds: Set<String> = []

    public init(
        stateMap: any LiveActivityStateMapping = LiveActivityStateMap.shared,
        store: any ActivityIdStoring = UserDefaultsActivityIdStore(),
        adapter: any LiveActivityAdapter = RealLiveActivityAdapter(),
        eta: any ETAProvider = DefaultETAProvider(),
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.stateMap = stateMap
        self.store = store
        self.adapter = adapter
        self.eta = eta
        self.now = now
    }

    // MARK: - Public surface

    /// Start a Live Activity for a transfer. Idempotent: if an activity
    /// already exists for `transfer.id`, updates it instead of starting
    /// a second one. Returns the handle's `(activityId, transferId)`.
    @discardableResult
    public func start(for transfer: TransferShape, recipient: Recipient) async throws -> LiveActivityToken {
        let attributes = KolaleafTransferAttributes(
            transferId: transfer.id,
            recipientName: recipient.fullName,
            recipientCurrency: "NGN",
            audAmount: transfer.sendAmount,
            ngnAmount: transfer.receiveAmount ?? "",
            exchangeRate: transfer.exchangeRate
        )

        // Status must map to an updatable band; CREATED / unknown have
        // no surface yet (the first AWAITING_AUD push starts one).
        let band: LiveActivityState
        switch stateMap.action(for: transfer.status) {
        case .update(let s):
            band = s
        case .end, .ignore:
            // Pre-AWAITING_AUD or terminal — there is nothing to start.
            // Caller should drive the activity once the backend
            // transitions the transfer to a renderable band.
            return LiveActivityToken(activityId: "", transferId: transfer.id)
        }

        let stageLabel = LiveActivityStageLabels.label(
            for: transfer.status,
            recipientName: recipient.fullName
        )
        let contentState = KolaleafTransferAttributes.ContentState(
            state: band,
            etaSeconds: eta.etaSeconds(for: band),
            lastUpdate: now(),
            stageLabel: stageLabel
        )
        let content = ActivityContent(state: contentState, staleDate: nil)

        // Idempotency: scan currentActivities for an existing one and
        // update instead of double-starting.
        if let existing = await findExistingHandle(transferId: transfer.id) {
            await existing.update(content)
            handles[transfer.id] = existing
            await store.set(activityId: existing.id, forTransferId: transfer.id)
            return LiveActivityToken(activityId: existing.id, transferId: transfer.id)
        }

        let handle = try await adapter.request(attributes: attributes, content: content)
        handles[transfer.id] = handle
        await store.set(activityId: handle.id, forTransferId: transfer.id)
        // A fresh start cancels any previous "ended" guard for this id
        // so a re-started transfer can complete cleanly later.
        endedTransferIds.remove(transfer.id)
        return LiveActivityToken(activityId: handle.id, transferId: transfer.id)
    }

    /// Apply a backend status update. Routes to `Activity.update(...)`
    /// or `Activity.end(...)` per the `LiveActivityStateMap` table.
    public func apply(_ transfer: TransferShape, recipientName: String = "") async {
        switch stateMap.action(for: transfer.status) {
        case .update(let band):
            await pushUpdate(transferId: transfer.id, band: band, status: transfer.status, recipientName: recipientName)
            // COMPLETED gets a 60-second grace so the user sees the
            // green check before the activity disappears (per spec).
            if transfer.status == .completed {
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
    public func end(transferId: String, dismissalPolicy: ActivityKitDismissalPolicy = .default) async {
        guard !endedTransferIds.contains(transferId) else { return }
        endedTransferIds.insert(transferId)

        let handle: LiveActivityHandle?
        if let cached = handles[transferId] {
            handle = cached
        } else {
            handle = await findExistingHandle(transferId: transferId)
        }
        if let handle {
            await handle.end(nil, dismissalPolicy: dismissalPolicy.ui)
        }
        handles.removeValue(forKey: transferId)
        await store.remove(transferId: transferId)
    }

    /// Reconcile the persisted `transferId → activityId` map against
    /// the OS's live `Activity.activities` list. Drops stale entries
    /// the OS killed while we were suspended, re-indexes survivors.
    public func reconcileOnLaunch() async {
        let live = await adapter.currentActivities()
        let liveByTransferId = Dictionary(uniqueKeysWithValues: live.map { ($0.transferId, $0) })

        let persisted = await store.all()
        var fresh: [String: LiveActivityHandle] = [:]
        for (transferId, _) in persisted {
            if let handle = liveByTransferId[transferId] {
                fresh[transferId] = handle
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
        // run cleanly.
        endedTransferIds = endedTransferIds.intersection(Set(persisted.keys).subtracting(fresh.keys))
    }

    // MARK: - Internals

    private func pushUpdate(
        transferId: String,
        band: LiveActivityState,
        status: TransferStatus,
        recipientName: String
    ) async {
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
            return
        }
        handles[transferId] = handle

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
        await handle.update(ActivityContent(state: contentState, staleDate: nil))
    }

    private func endAfterGrace(transferId: String, seconds: TimeInterval) async {
        // Detached so the apply(...) caller doesn't await the whole
        // grace period. Using Task is fine here — MainActor isolation
        // is preserved across the await.
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            await self?.end(transferId: transferId, dismissalPolicy: .immediate)
        }
    }

    private func findExistingHandle(transferId: String) async -> LiveActivityHandle? {
        if let cached = handles[transferId] { return cached }
        let live = await adapter.currentActivities()
        return live.first { $0.transferId == transferId }
    }
}
