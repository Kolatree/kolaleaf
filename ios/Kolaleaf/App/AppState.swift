// AppState.swift  (Phase 0 · U8 + U76b primitives)
// Central observable state container, MainActor-isolated.
//
// r2-review fixes · 2026-05-09:
//   • #3 (correctness): markForegrounded() no longer bumps interaction; the foreground
//     idle check is now reachable. Caller must compute shouldForceReauth() BEFORE
//     marking the scene foregrounded.
//   • #5 (correctness): TransferStatus has a custom Decodable that maps unknown
//     rawValues to .unknown, fulfilling the forward-compat contract.
//   • #11 (concurrency): @MainActor isolation makes the [weak appState] capture safe
//     under -strict-concurrency=complete.
//   • #16 (reliability): lastInteractionAt + lastBackgroundedAt persist to UserDefaults
//     so cold launch after force-quit honors the idle window correctly.

import Foundation
import Observation

@MainActor
@Observable
public final class AppState {

    // MARK: - Identity

    public var currentUser: CurrentUser?
    public var kycStatus: KycStatus = .unknown
    public var hasActiveSession: Bool { currentUser != nil }

    // MARK: - Active tab (Phase 4 · U33)
    //
    // Persisted across cold launches so a kill-and-relaunch returns
    // the user to the tab they were on. Cleared by `clearForLogout()`
    // (along with the rest of session state) so a fresh sign-in
    // always starts on `.send`.

    public var selectedTab: RootTab = .send {
        didSet {
            guard selectedTab != oldValue else { return }
            defaults.set(selectedTab.rawValue, forKey: Self.kSelectedTab)
        }
    }

    /// True after the user has completed both PostKYC steps (Confirm
    /// Profile + Confirm Address). RootRouter uses this together with
    /// `kycStatus` to choose between PostKYCCoordinator and
    /// MainTabView. Persisted across cold launches so a kill before
    /// MainTab loads doesn't trap the user back on PostKYC even
    /// though they already saved.
    public var hasCompletedPostKYC: Bool = false {
        didSet {
            guard hasCompletedPostKYC != oldValue else { return }
            defaults.set(hasCompletedPostKYC, forKey: Self.kPostKYCComplete)
        }
    }

    /// Product change (2026-05-13): user can defer KYC at the intro
    /// screen. Persisted so a kill-and-relaunch keeps them in MainTab
    /// rather than bouncing back to the KYC intro. Backend enforces
    /// KYC at transfer-processing time — a deferred user can browse,
    /// prepare a transfer, even submit one, but the actual ledger
    /// movement is gated until KYC clears.
    ///
    /// When the user later completes verification, `kycStatus` flips
    /// to `.verified` and PostKYC completes — at that point this
    /// flag becomes redundant (the verified path takes over routing).
    /// We keep it set rather than clearing it so a user who skipped
    /// once doesn't bounce back through the intro after a session
    /// refresh that loads `.unknown` before `/account/me` resolves.
    public var kycSkipped: Bool = false {
        didSet {
            guard kycSkipped != oldValue else { return }
            defaults.set(kycSkipped, forKey: Self.kKycSkipped)
        }
    }

    /// Mark the user as having deferred KYC. Called from
    /// `KYCIntroView`'s "Maybe later" action via OnboardingCoordinator.
    public func markKycSkipped() {
        kycSkipped = true
    }

    /// ADV-008 / CA-006: true once a successful `/account/me` (or
    /// `/kyc/status`) response has resolved the user's current
    /// `kycStatus`. Until this flips RootRouter routes to a quiet
    /// `.loading` shell instead of folding `.unknown` into
    /// `.onboardingResumeAtKYC` (which causes a one-frame flicker
    /// to the KYC intro for verified users on cold launch).
    /// Not persisted — every cold launch starts unloaded.
    public private(set) var kycStatusLoaded: Bool = false

    public struct NewDeviceAlert: Identifiable, Equatable, Sendable {
        public let id = UUID()
        public let title: String
        public let message: String
    }

    public var newDeviceAlert: NewDeviceAlert?

    public func showNewDeviceAlert(title: String, message: String) {
        newDeviceAlert = NewDeviceAlert(title: title, message: message)
    }

    public func dismissNewDeviceAlert() {
        newDeviceAlert = nil
    }

    /// Set when `refreshPostKYCStateFromServer` exhausts retries on a
    /// post-login bootstrap call. Without this, a single `/account/me`
    /// failure (network blip, captive portal, server hiccup) would
    /// permanently strand the user on `LoadingShell` since
    /// `RootCoordinator.task(id: currentUser?.id)` only re-fires on
    /// identity change. RootRouter checks this BEFORE the
    /// kycStatusLoaded gate so the user sees a recoverable error UI
    /// rather than a forever-spinning shell.
    public internal(set) var bootstrapError: String?

    private static let kSelectedTab = "kola.selectedTab"
    private static let kPostKYCComplete = "kola.postKYCComplete"
    private static let kKycSkipped = "kola.kycSkipped"

    /// PostKYCCoordinator's terminal handler. Public so RootCoordinator
    /// can wire it as the `onPostKYCComplete` closure without exposing
    /// the persisted-flag implementation detail to the Coordinator.
    public func markPostKYCComplete() {
        hasCompletedPostKYC = true
    }

    /// OO-006: thin wrapper around `markPostKYCComplete` so callers
    /// (RootCoordinator's PostKYC closure) bind to a method on
    /// AppState rather than to the persistence-flag setter directly.
    /// Future side-effects on PostKYC completion (analytics, transient
    /// in-flight cleanup) compose here without rewiring callers.
    public func handlePostKYCComplete() {
        markPostKYCComplete()
    }

    /// ADV-007: refresh `hasCompletedPostKYC` (and the cached
    /// `kycStatus`) from the server. Defends against iCloud Restore
    /// leaking the flag from another user's UserDefaults — local
    /// cache is best-effort, the server row is the source of truth.
    ///
    /// Behaviour:
    ///   • Success: derive `displayName != nil && addressLine1 != nil`
    ///     as the completion signal (Phase 3 added these fields), and
    ///     overwrite the local flag. Also sync `kycStatus` and flip
    ///     `kycStatusLoaded` so RootRouter exits the `.loading` shell.
    ///   • Failure: leave the cached flag alone. Network blips on
    ///     cold launch should not bounce a verified user back through
    ///     PostKYC.
    public func refreshPostKYCStateFromServer(api: AuthAPI) async {
        // Backoff schedule: 0s / 1s / 3s. Three attempts cover most
        // transient blips (network handoff, edge cold-start, single
        // 5xx) without keeping the user on the spinner for long.
        let backoffs: [UInt64] = [0, 1_000_000_000, 3_000_000_000]
        var lastErrorMessage: String?
        for delay in backoffs {
            if delay > 0 { try? await Task.sleep(nanoseconds: delay) }
            let result = await api.send(AccountEndpoints.Me())
            switch result {
            case .success(let me):
                let derived = (me.displayName != nil) && (me.addressLine1 != nil)
                if hasCompletedPostKYC != derived {
                    hasCompletedPostKYC = derived  // didSet persists.
                }
                kycStatus = me.kycStatus
                kycStatusLoaded = true
                bootstrapError = nil  // clear any prior failure UI.
                return
            case .failure(let err):
                lastErrorMessage = err.errorDescription ?? "Couldn't reach Kolaleaf."
            }
        }
        // All retries exhausted — surface a recoverable error rather
        // than silently leaving the user on the loading shell forever.
        bootstrapError = lastErrorMessage ?? "Couldn't reach Kolaleaf."
    }

    /// Called by the bootstrap-error UI's Retry action. Clears the
    /// surfaced error so RootRouter falls back to `.loading` and the
    /// `.task(id: currentUser?.id)` re-fires on the next render of
    /// RootCoordinator (driven by the explicit `await refresh...`
    /// the view performs after clearing).
    public func clearBootstrapError() {
        bootstrapError = nil
    }

    /// ADV-008 / CA-006: explicit setter used by call sites that
    /// fetch `/kyc/status` directly (e.g. KYCProcessingViewModel)
    /// so the loaded-bit flips even when the refresh path doesn't go
    /// through `/account/me`.
    public func markKycStatusLoaded() {
        kycStatusLoaded = true
    }

    /// Set by SignInViewModel when backend returns 200 with `requires2FA: true`. The
    /// backend has NOT issued a session cookie in that case — it's waiting for the
    /// 2FA challenge to clear. Until U73-U75 (Phase 11) lands the challenge UI, the
    /// app blocks 2FA-enabled accounts with this state instead of falsely showing
    /// the user as authenticated. SignInView reads this and renders an inline notice.
    public var pendingTwoFactor: PendingTwoFactor?

    // MARK: - Active flow

    public var activeTransfer: ActiveTransfer?
    /// ADV-P10A-C1 (Phase 10A iter-2): transferId the Live Activity
    /// deep link asked us to open, captured during `.onOpenURL`. The
    /// ActivityTabRoot reads + clears it on first appear so the
    /// router routes once and never re-opens on tab re-mount. Not
    /// persisted — a kill-and-relaunch via the deep link will set it
    /// again on next foreground.
    public var pendingTransferDetailId: String?
    /// Phase 6 iter-2 (C6 / ADV-P6-C4): true while the iOS-side submit
    /// is in flight, BEFORE a real backend transfer id exists. Idle
    /// extension logic reads this flag alongside `activeTransfer` so
    /// the 90-minute in-flight idle window covers the pre-create
    /// network round-trip too. Replaces the previous sentinel
    /// `ActiveTransfer(id: "local-pending", …)` hack.
    public var isSubmittingTransfer: Bool = false

    // MARK: - Network

    public var isReachable: Bool = true

    // MARK: - Idle tracking (U76b)
    //
    // Backend session TTL is 15 min sliding (src/lib/auth/sessions.ts:8 SESSION_EXPIRY_MINUTES = 15).
    // iOS idle threshold sits one minute below to align.
    //
    // U76b3: per-instance thresholds may be overridden via launch args
    // (`--idle-threshold=<n>`, `--background-idle=<n>`, `--inflight-idle=<n>`)
    // for UI tests that need to compress the clock. DEBUG only — release builds
    // ignore the args.

    /// Production default: foreground idle window (14 min, one minute below backend TTL).
    public static let defaultIdleThresholdSeconds: TimeInterval = 14 * 60
    /// Production default: background idle window (15 min, matches backend TTL).
    public static let defaultBackgroundIdleSeconds: TimeInterval = 15 * 60
    /// Production default: extended idle while a transfer is in-flight (90 min).
    public static let defaultInflightIdleSeconds: TimeInterval = 90 * 60

    /// Legacy aliases preserved for callers that still read static thresholds.
    /// New code should read instance properties so tests can override via launch args.
    public static let idleThresholdSeconds: TimeInterval = defaultIdleThresholdSeconds
    public static let backgroundIdleSeconds: TimeInterval = defaultBackgroundIdleSeconds
    public static let inflightIdleSeconds: TimeInterval = defaultInflightIdleSeconds

    /// Per-instance foreground idle threshold (seconds). May differ from the static
    /// default in DEBUG builds when `--idle-threshold=<n>` is passed.
    public let idleThresholdSeconds: TimeInterval
    /// Per-instance background idle threshold. DEBUG override: `--background-idle=<n>`.
    public let backgroundIdleSeconds: TimeInterval
    /// Per-instance in-flight extended idle threshold. DEBUG override: `--inflight-idle=<n>`.
    public let inflightIdleSeconds: TimeInterval

    private(set) public var lastInteractionAt: Date
    private(set) public var lastBackgroundedAt: Date?

    // Keys used to persist across cold launches.
    private static let kLastInteractionAt = "kola.lastInteractionAt"
    private static let kLastBackgroundedAt = "kola.lastBackgroundedAt"

    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard,
                arguments: [String] = ProcessInfo.processInfo.arguments) {
        self.defaults = defaults

        #if DEBUG
        self.idleThresholdSeconds = Self.parseLaunchArg(
            arguments, key: "--idle-threshold=",
            default: Self.defaultIdleThresholdSeconds)
        self.backgroundIdleSeconds = Self.parseLaunchArg(
            arguments, key: "--background-idle=",
            default: Self.defaultBackgroundIdleSeconds)
        self.inflightIdleSeconds = Self.parseLaunchArg(
            arguments, key: "--inflight-idle=",
            default: Self.defaultInflightIdleSeconds)
        #else
        self.idleThresholdSeconds = Self.defaultIdleThresholdSeconds
        self.backgroundIdleSeconds = Self.defaultBackgroundIdleSeconds
        self.inflightIdleSeconds = Self.defaultInflightIdleSeconds
        #endif

        // Restore persisted state so cold launch after force-quit honors prior idle.
        let restoredInteraction = (defaults.object(forKey: Self.kLastInteractionAt) as? Date)
            ?? Date()
        let restoredBackground = defaults.object(forKey: Self.kLastBackgroundedAt) as? Date
        self.lastInteractionAt = restoredInteraction
        self.lastBackgroundedAt = restoredBackground

        // Phase 4 / U33: restore the last-active tab so cold launch
        // returns the user where they left off. didSet is suppressed
        // by direct assignment in init, so no spurious write here.
        if let raw = defaults.string(forKey: Self.kSelectedTab),
           let tab = RootTab(rawValue: raw) {
            self.selectedTab = tab
        }
        // Phase 4 / U33: restore the post-KYC-complete flag so a
        // cold launch after the user finished PostKYC routes
        // directly to MainTab instead of looping them back through
        // Confirm Profile.
        self.hasCompletedPostKYC = defaults.bool(forKey: Self.kPostKYCComplete)
        // Restore the deferred-KYC flag so a relaunch keeps the user
        // in MainTab rather than bouncing them back to the KYC intro.
        self.kycSkipped = defaults.bool(forKey: Self.kKycSkipped)
    }

    /// Parses `--<key>=<n>` from a launch-args array. Clamps to `[1, 3600]` seconds.
    /// Returns `fallback` when the arg is missing, malformed, or out-of-clamp.
    private static func parseLaunchArg(_ args: [String],
                                       key: String,
                                       default fallback: TimeInterval) -> TimeInterval {
        guard let arg = args.first(where: { $0.hasPrefix(key) }),
              let value = TimeInterval(arg.dropFirst(key.count)),
              value.isFinite else {
            return fallback
        }
        return min(max(value, 1), 3600)
    }

    // MARK: - Mutations

    /// Reset on user touch, successful API call, or APNS state-change push for the active transfer.
    public func bumpInteraction() {
        lastInteractionAt = Date()
        defaults.set(lastInteractionAt, forKey: Self.kLastInteractionAt)
    }

    public func markBackgrounded() {
        lastBackgroundedAt = Date()
        defaults.set(lastBackgroundedAt, forKey: Self.kLastBackgroundedAt)
    }

    /// Does NOT bump interaction (per r2 fix #3 + #8) — the caller must check
    /// `shouldForceReauth()` BEFORE invoking this so the idle clock is preserved.
    public func markForegrounded() {
        lastBackgroundedAt = nil
        defaults.removeObject(forKey: Self.kLastBackgroundedAt)
    }

    /// True when the iOS-side idle window has elapsed and the app should force re-auth.
    public func shouldForceReauth() -> Bool {
        // Must have an active session for "force re-auth" to even be meaningful.
        guard hasActiveSession else { return false }

        let now = Date()

        // Background path: any backgrounding longer than 15 min triggers re-auth.
        if let bg = lastBackgroundedAt, now.timeIntervalSince(bg) >= self.backgroundIdleSeconds {
            return true
        }

        // Foreground idle path. While a transfer is in-flight (either
        // tracked or mid-submit), extend window.
        let inFlight = (activeTransfer?.isInFlight == true) || isSubmittingTransfer
        let threshold: TimeInterval = inFlight
            ? self.inflightIdleSeconds
            : self.idleThresholdSeconds
        return now.timeIntervalSince(lastInteractionAt) >= threshold
    }

    /// Clears all session state on logout.
    ///
    /// P1 fix (Phase 1 review): set lastInteractionAt to .distantPast rather than Date().
    /// A future code path that calls clearForLogout WITHOUT also calling
    /// KolaleafApp.forceReauth (which clears the cookie jar) would otherwise leave a
    /// 14-min idle window during which shouldForceReauth returns false even though
    /// the local session state is gone. distantPast guarantees any subsequent
    /// hasActiveSession=true rehydration immediately demands re-auth.
    public func clearForLogout() {
        currentUser = nil
        kycStatus = .unknown
        // ADV-008 / CA-006: reset so the next session's RootRouter
        // routes to .loading until the new user's /account/me lands.
        kycStatusLoaded = false
        bootstrapError = nil
        activeTransfer = nil
        isSubmittingTransfer = false
        pendingTwoFactor = nil
        newDeviceAlert = nil
        // Phase 4 / U33: clear the active tab so a fresh sign-in
        // always starts on `.send`, never on a previous user's
        // (e.g. Account) tab. didSet would persist `.send` again so
        // we explicitly drop the key after.
        selectedTab = .send
        defaults.removeObject(forKey: Self.kSelectedTab)
        // Phase 4 / U33: PostKYC completion is per-user; logout
        // clears it so the next user (or re-onboarding flow) lands
        // on Confirm Profile / Confirm Address again.
        hasCompletedPostKYC = false
        defaults.removeObject(forKey: Self.kPostKYCComplete)
        // Deferred-KYC flag is per-user too: a fresh sign-in starts
        // with the KYC intro flow visible (the next user makes their
        // own choice to verify or defer).
        kycSkipped = false
        defaults.removeObject(forKey: Self.kKycSkipped)
        lastInteractionAt = Date.distantPast
        lastBackgroundedAt = nil
        defaults.set(lastInteractionAt, forKey: Self.kLastInteractionAt)
        defaults.removeObject(forKey: Self.kLastBackgroundedAt)
    }
}

// MARK: - CurrentUserStore conformance (CA-003)
//
// `AppState` is the production implementation of `CurrentUserStore`.
// Lives next to `AppState` itself so the conformance + mutation
// semantics (preserve legalName / email / phone; update only the
// display name) stay in one place. PostKYC view models depend on the
// protocol so they're testable without an `AppState`.

extension AppState: CurrentUserStore {
    public func updateDisplayName(_ name: String) {
        guard let user = currentUser else { return }
        currentUser = CurrentUser(
            id: user.id,
            displayName: name,
            // Legal name is KYC-verified — never mutated through this
            // surface. The contract is enforced here so callers can't
            // accidentally drift it via a different code path.
            legalName: user.legalName,
            email: user.email,
            phone: user.phone
        )
    }
}

// MARK: - PendingTwoFactor

/// Captured when sign-in returns `requires2FA: true`. The challenge UI lands in
/// Phase 11 (U73-U75); until then SignInView surfaces `blockedReason` to the user.
public struct PendingTwoFactor: Equatable, Sendable {
    public let method: String           // "TOTP" / "SMS" / "NONE"
    public let blockedReason: String?

    public init(method: String, blockedReason: String? = nil) {
        self.method = method
        self.blockedReason = blockedReason
    }
}

// MARK: - Domain types referenced by AppState

public struct CurrentUser: Equatable, Sendable {
    public let id: String
    public let displayName: String?
    public let legalName: String?
    public let email: String?
    public let phone: String?

    public init(id: String, displayName: String?, legalName: String?, email: String?, phone: String?) {
        self.id = id
        self.displayName = displayName
        self.legalName = legalName
        self.email = email
        self.phone = phone
    }
}

/// Mirror of `enum KycStatus` in `prisma/schema.prisma`. Backend rawValues are
/// authoritative — the original iOS draft invented its own status names
/// (`NOT_STARTED / PROCESSING / APPROVED / SOFT_REJECTED / UNDER_REVIEW /
/// HARD_REJECTED`) that never round-tripped through `GET /kyc/status`. Phase 2
/// fix: align rawValues to the wire contract and use a custom Decodable that
/// maps unknown strings to `.unknown` for forward-compat (same pattern as
/// `TransferStatus`).
///
/// Wave 1 backend exposes a single REJECTED state — there is no soft/hard
/// split at the data layer. iOS routes REJECTED to a single retry-able screen
/// (`KYCSoftRejectionView` / U26) that calls `POST /kyc/retry`; backend
/// returns 409 if retry is no longer eligible, which is iOS' signal to fall
/// back to a hard-rejection contact-support screen.
public enum KycStatus: String, Equatable, Sendable {
    case pending  = "PENDING"
    case inReview = "IN_REVIEW"
    case verified = "VERIFIED"
    case rejected = "REJECTED"
    /// Sentinel for any rawValue not recognized at this iOS build's release.
    /// The non-colliding rawValue prevents accidental impersonation by a
    /// future backend literal.
    case unknown  = "_iOS_UNKNOWN"
}

extension KycStatus: Codable {
    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = KycStatus(rawValue: raw) ?? .unknown
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(self.rawValue)
    }
}

/// Tracks the user's currently-in-flight transfer, if any.
public struct ActiveTransfer: Equatable, Sendable {
    public let id: String
    public let status: TransferStatus
    public let audAmount: Decimal
    public let ngnAmount: Decimal
    public let recipientId: String
    /// Wire-supplied exchange rate (NGN per AUD). Mirrored from the
    /// processing-poll transfer so the expired-screen can render the
    /// locked rate without re-fetching (CA-902 / ADV-P9-W2). Defaults
    /// to `0`; the expired destination falls back to a Get-by-id when
    /// this is 0 OR when the activeTransfer mirror is missing entirely.
    public let exchangeRate: Decimal

    public var isInFlight: Bool {
        switch status {
        case .completed, .cancelled, .expired, .refunded, .needsManual, .unknown:
            return false
        default:
            return true
        }
    }

    public init(
        id: String,
        status: TransferStatus,
        audAmount: Decimal,
        ngnAmount: Decimal,
        recipientId: String,
        exchangeRate: Decimal = 0
    ) {
        self.id = id
        self.status = status
        self.audAmount = audAmount
        self.ngnAmount = ngnAmount
        self.recipientId = recipientId
        self.exchangeRate = exchangeRate
    }
}

/// Mirror of `enum TransferStatus` in `prisma/schema.prisma:26`. Custom Codable
/// maps unknown rawValues to `.unknown` so a future backend status doesn't break
/// decoding — that's the actual forward-compat contract (r2 fix #5).
public enum TransferStatus: String, Equatable, Sendable {
    case created           = "CREATED"
    case awaitingAud       = "AWAITING_AUD"
    case audReceived       = "AUD_RECEIVED"
    case processingNgn     = "PROCESSING_NGN"
    case ngnSent           = "NGN_SENT"
    case completed         = "COMPLETED"
    case ngnFailed         = "NGN_FAILED"
    case ngnRetry          = "NGN_RETRY"
    case needsManual       = "NEEDS_MANUAL"
    case refunded          = "REFUNDED"
    case expired           = "EXPIRED"
    case cancelled         = "CANCELLED"
    case floatInsufficient = "FLOAT_INSUFFICIENT"
    /// Sentinel for any rawValue not recognized at this iOS build's release. The non-
    /// colliding rawValue prevents accidental impersonation by a backend literal.
    case unknown           = "_iOS_UNKNOWN"
}

// MARK: - TransferStatus buckets (Phase 8 iter-2 · A3)
//
// Centralised here so Activity, Statements, ActivityRow, and any
// future surface (Refer stats, Help recent-transfer pill) all map
// the same Prisma literals to the same UX bucket. Iter-1 had two
// disagreeing definitions of "completed" — the row label said
// COMPLETED+NGN_SENT, the filter chip set said COMPLETED+REFUNDED.
// One audit logged a refund as a completion; the other counted an
// in-flight transfer as done. Both were wrong.
//
// The buckets reflect the Transfer state machine in the project
// CLAUDE.md:
//   • inFlight        — anything pre-terminal (CREATED through NGN_RETRY,
//                       plus FLOAT_INSUFFICIENT pause and NGN_SENT
//                       on the optimistic-pending path).
//   • terminalSuccess — COMPLETED only. NGN_SENT is *in-flight* even
//                       though it commonly resolves within seconds;
//                       audit + tax math must not conflate it.
//   • terminalFailure — NGN_FAILED / NEEDS_MANUAL / EXPIRED / CANCELLED
//                       / REFUNDED. Refunded sits in failure-bucket
//                       UI because the money came back to the user
//                       rather than reaching the recipient — never in
//                       the "completed" bucket.
public extension TransferStatus {
    /// Pre-terminal: money is on the move. Pending UI bucket.
    static var inFlight: Set<TransferStatus> {
        [
            .created, .awaitingAud, .audReceived,
            .processingNgn, .ngnSent, .ngnRetry,
            .floatInsufficient,
        ]
    }

    /// Terminal-success: money reached the recipient. The ONLY status
    /// that contributes to tax rollups and "this month sent" totals.
    static var terminalSuccess: Set<TransferStatus> { [.completed] }

    /// Terminal-failure: money never reached the recipient (or came
    /// back). REFUNDED lives here, not under success.
    static var terminalFailure: Set<TransferStatus> {
        [.ngnFailed, .needsManual, .expired, .cancelled, .refunded]
    }
}

extension TransferStatus: Codable {
    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        if let status = TransferStatus(rawValue: raw) {
            self = status
        } else {
            // Iter-2 (S12 / ADV-P6-S1): one-shot analytics signal so
            // a backend release that adds a status literal surfaces
            // immediately. Production wires `unknownTransferStatusHook`
            // to the analytics pipe; DEBUG prints to stderr.
            TransferStatus.notifyUnknown(raw)
            self = .unknown
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(self.rawValue)
    }

    /// Iter-2 (S12 / ADV-P6-S1): analytics hook for unknown wire
    /// literals. Production wires this to the analytics pipe; in
    /// DEBUG without a hook configured we print to stderr.
    public nonisolated(unsafe) static var unknownStatusHook: (@Sendable (String) -> Void)?

    private static func notifyUnknown(_ raw: String) {
        if let hook = unknownStatusHook {
            hook(raw)
            return
        }
        #if DEBUG
        print("[TransferStatus] decoded unknown rawValue: \(raw)")
        #endif
    }
}
