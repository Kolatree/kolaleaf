// AnalyticsServiceTests.swift  (Phase 11.6 · U89)

import XCTest
@testable import Kolaleaf

@MainActor
final class AnalyticsServiceTests: XCTestCase {

    private func makeDefaults() -> UserDefaults {
        let suite = "kola.analytics.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        return defaults
    }

    func test_track_postsPrivacySafeEventWithSystemOrigin() async {
        let api = FakeAPIClient()
        await api.stageSuccess(AnalyticsEndpoints.Track.self, EmptyResponse())
        let service = AnalyticsService(api: api, defaults: makeDefaults())

        await service.track(
            .sendScreenViewed,
            properties: [
                "screen": .string("send"),
                "durationMs": .int(120),
            ],
            occurredAt: Date(timeIntervalSince1970: 1_700_000_000)
        )

        let calls = await api.calls.filter { $0.path == "/api/v1/analytics/events" }
        XCTAssertEqual(calls.count, 1)
        XCTAssertEqual(calls.first?.origin, .system)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let body = calls.first?.bodyData.flatMap {
            try? decoder.decode(AnalyticsEventRequest.self, from: $0)
        }
        XCTAssertEqual(body?.event, .sendScreenViewed)
        XCTAssertEqual(body?.properties["screen"], .string("send"))
        XCTAssertEqual(body?.properties["durationMs"], .int(120))
    }

    func test_scrub_dropsPIIAndUnknownProperties() {
        let scrubbed = AnalyticsService.scrub([
            "screen": .string("send"),
            "recipientName": .string("Folasade"),
            "email": .string("a@example.com"),
            "amount": .int(100),
            "source": .string("+61400000000"),
            "unapproved": .string("value"),
        ])

        XCTAssertEqual(scrubbed, ["screen": .string("send")])
    }

    func test_track_buffersOfflineEventAndFlushesLater() async {
        let defaults = makeDefaults()
        let api = FakeAPIClient()
        await api.stageFailure(AnalyticsEndpoints.Track.self, .transport("offline"))
        let service = AnalyticsService(api: api, defaults: defaults)

        await service.track(.welcomeShown, properties: ["screen": .string("welcome")])
        let pending = service.pendingCount()
        XCTAssertEqual(pending, 1)

        await api.stageSuccess(AnalyticsEndpoints.Track.self, EmptyResponse())
        await service.flush()

        let remaining = service.pendingCount()
        XCTAssertEqual(remaining, 0)
        let calls = await api.calls.filter { $0.path == "/api/v1/analytics/events" }
        XCTAssertEqual(calls.count, 2)
    }
}
