// AnalyticsService.swift  (Phase 11.6 · U89)
// Privacy-first KPI event client. No third-party SDK: events post to
// Kolaleaf's own API, use system-origin requests, and buffer locally
// when offline.

import Foundation

@MainActor
public final class AnalyticsService {
    private static let queueKey = "kola.analytics.pendingEvents"
    private static let allowedProperties: Set<String> = [
        "attempt",
        "count",
        "durationMs",
        "method",
        "result",
        "screen",
        "source",
        "step",
    ]
    private static let sensitiveFragments = [
        "account",
        "address",
        "amount",
        "bank",
        "email",
        "name",
        "phone",
        "recipient",
        "token",
    ]

    private let api: AuthAPI
    private let defaults: UserDefaults
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    private let maxBufferedEvents: Int

    public init(
        api: AuthAPI,
        defaults: UserDefaults = .standard,
        maxBufferedEvents: Int = 100
    ) {
        self.api = api
        self.defaults = defaults
        self.maxBufferedEvents = maxBufferedEvents
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        self.encoder = encoder
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        self.decoder = decoder
    }

    public func track(
        _ event: AnalyticsEvent,
        properties: [String: AnalyticsPropertyValue] = [:],
        occurredAt: Date = Date()
    ) async {
        let request = AnalyticsEventRequest(
            event: event,
            occurredAt: occurredAt,
            properties: Self.scrub(properties)
        )
        switch await post(request) {
        case .success:
            await flush()
        case .failure:
            buffer(request)
        }
    }

    public func flush() async {
        let queued = loadQueue()
        guard !queued.isEmpty else { return }

        var remaining: [AnalyticsEventRequest] = []
        for (index, request) in queued.enumerated() {
            switch await post(request) {
            case .success:
                continue
            case .failure:
                remaining = Array(queued[index...])
                break
            }
        }
        saveQueue(remaining)
    }

    public func pendingCount() -> Int {
        loadQueue().count
    }

    public static func scrub(
        _ properties: [String: AnalyticsPropertyValue]
    ) -> [String: AnalyticsPropertyValue] {
        var output: [String: AnalyticsPropertyValue] = [:]
        for (key, value) in properties {
            let normalized = key.trimmingCharacters(in: .whitespacesAndNewlines)
            let lower = normalized.lowercased()
            guard allowedProperties.contains(normalized) else { continue }
            guard !sensitiveFragments.contains(where: { lower.contains($0) }) else { continue }
            guard let clean = scrub(value) else { continue }
            output[normalized] = clean
        }
        return output
    }

    private static func scrub(_ value: AnalyticsPropertyValue) -> AnalyticsPropertyValue? {
        switch value {
        case .string(let string):
            let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
            guard trimmed.count <= 80 else { return nil }
            guard !trimmed.contains("@") else { return nil }
            guard trimmed.range(of: #"\+\d{8,15}"#, options: .regularExpression) == nil else {
                return nil
            }
            return .string(trimmed)
        case .int, .double, .bool:
            return value
        }
    }

    private func post(_ request: AnalyticsEventRequest) async -> Result<Void, APIError> {
        let result = await api.send(AnalyticsEndpoints.Track(request), origin: .system)
        switch result {
        case .success:
            return .success(())
        case .failure(let error):
            return .failure(error)
        }
    }

    private func buffer(_ request: AnalyticsEventRequest) {
        var queued = loadQueue()
        queued.append(request)
        if queued.count > maxBufferedEvents {
            queued = Array(queued.suffix(maxBufferedEvents))
        }
        saveQueue(queued)
    }

    private func loadQueue() -> [AnalyticsEventRequest] {
        guard let data = defaults.data(forKey: Self.queueKey),
              let queued = try? decoder.decode([AnalyticsEventRequest].self, from: data) else {
            return []
        }
        return queued
    }

    private func saveQueue(_ queued: [AnalyticsEventRequest]) {
        guard !queued.isEmpty else {
            defaults.removeObject(forKey: Self.queueKey)
            return
        }
        guard let data = try? encoder.encode(queued) else { return }
        defaults.set(data, forKey: Self.queueKey)
    }
}
