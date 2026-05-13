// PushTokenSyncTests.swift  (Phase 10B · U72)
//
// Live Activity push tokens are per-activity AsyncSequences. Tests
// drive the sync surface with an `AsyncStream<Data>` so we don't need
// a real `Activity<>` instance.

import XCTest
@testable import Kolaleaf

@MainActor
final class PushTokenSyncTests: XCTestCase {

    // MARK: - observe

    func test_observe_postsHexEncodedToken() async {
        let api = FakeAPIClient()
        await api.stageSuccess(PushTokenEndpoints.Register.self, EmptyResponse())
        let sync = PushTokenSync(api: api, bundleId: "com.kolaleaf.test", device: "iPhone16,1")

        let (stream, cont) = makeTokenStream()
        cont.yield(Data([0xDE, 0xAD, 0xBE, 0xEF]))
        cont.finish()
        await sync.observe(activityId: "act_1", tokens: stream)

        let body = await api.lastBody(
            for: String(describing: PushTokenEndpoints.Register.self),
            as: RegisterPushTokenRequest.self
        )
        XCTAssertEqual(body?.deviceToken, "deadbeef")
        XCTAssertEqual(body?.kind, .liveActivity)
        XCTAssertEqual(body?.bundleId, "com.kolaleaf.test")
        XCTAssertEqual(body?.device, "iPhone16,1")
    }

    func test_observe_dedupesIdenticalTokens() async {
        let api = FakeAPIClient()
        await api.stageSuccess(PushTokenEndpoints.Register.self, EmptyResponse())
        let sync = PushTokenSync(api: api)

        let (stream, cont) = makeTokenStream()
        cont.yield(Data([0xAB]))
        cont.yield(Data([0xAB]))   // identical — should be suppressed.
        cont.finish()
        await sync.observe(activityId: "act_1", tokens: stream)

        let calls = await api.calls
        let registerCalls = calls.filter { $0.typeName == String(describing: PushTokenEndpoints.Register.self) }
        XCTAssertEqual(registerCalls.count, 1, "identical token must not re-POST")
    }

    func test_observe_postsRotatedTokenAsNewCall() async {
        let api = FakeAPIClient()
        await api.stageSuccess(PushTokenEndpoints.Register.self, EmptyResponse())
        let sync = PushTokenSync(api: api)

        let (stream, cont) = makeTokenStream()
        cont.yield(Data([0xAB]))
        cont.yield(Data([0xCD]))   // rotated — must POST again.
        cont.finish()
        await sync.observe(activityId: "act_1", tokens: stream)

        let calls = await api.calls
        let registerCalls = calls.filter { $0.typeName == String(describing: PushTokenEndpoints.Register.self) }
        XCTAssertEqual(registerCalls.count, 2)
    }

    // MARK: - resyncAllOnForeground

    func test_resync_replaysFailedTokenOnForeground() async {
        let api = FakeAPIClient()
        // Initial POST fails → token is held in pendingResync.
        await api.stageFailure(PushTokenEndpoints.Register.self, .transport("offline"))
        let sync = PushTokenSync(api: api)

        let (stream, cont) = makeTokenStream()
        cont.yield(Data([0xFE]))
        cont.finish()
        await sync.observe(activityId: "act_1", tokens: stream)

        // Stage a success and trigger resync.
        await api.stageSuccess(PushTokenEndpoints.Register.self, EmptyResponse())
        await sync.resyncAllOnForeground()

        let calls = await api.calls
        let registerCalls = calls.filter { $0.typeName == String(describing: PushTokenEndpoints.Register.self) }
        XCTAssertEqual(registerCalls.count, 2,
                       "resync must replay the unposted token on foreground")
    }

    func test_resync_isNoOpWhenAllTokensWereAcked() async {
        let api = FakeAPIClient()
        await api.stageSuccess(PushTokenEndpoints.Register.self, EmptyResponse())
        let sync = PushTokenSync(api: api)

        let (stream, cont) = makeTokenStream()
        cont.yield(Data([0xAA]))
        cont.finish()
        await sync.observe(activityId: "act_1", tokens: stream)

        let beforeCalls = (await api.calls).count
        await sync.resyncAllOnForeground()
        let afterCalls = (await api.calls).count
        XCTAssertEqual(beforeCalls, afterCalls,
                       "resync must NOT re-POST tokens already acked")
    }

    // MARK: - hex encoding contract

    func test_hex_lowercaseNoSpaces() {
        let hex = PushTokenSync.hex(from: Data([0x00, 0x0F, 0xFF]))
        XCTAssertEqual(hex, "000fff")
    }

    // MARK: - Helpers

    private func makeTokenStream() -> (AsyncStream<Data>, AsyncStream<Data>.Continuation) {
        var continuation: AsyncStream<Data>.Continuation!
        let stream = AsyncStream<Data> { cont in
            continuation = cont
        }
        return (stream, continuation)
    }
}
