// FeedbackDraft.swift  (Phase 12 · shake-to-report)
// Privacy-preserving report payloads. The app never attaches screenshots,
// logs, account data, or transfer identifiers automatically.

import Foundation
#if canImport(UIKit)
import UIKit
#endif

public enum FeedbackSource: String, Equatable, Sendable {
    case shake = "Shake gesture"
}

public struct FeedbackEnvironment: Equatable, Sendable {
    public let appVersion: String
    public let build: String
    public let osVersion: String
    public let deviceModel: String

    public init(
        appVersion: String,
        build: String,
        osVersion: String,
        deviceModel: String
    ) {
        self.appVersion = appVersion
        self.build = build
        self.osVersion = osVersion
        self.deviceModel = deviceModel
    }

    @MainActor
    public static var current: FeedbackEnvironment {
        let bundle = Bundle.main
        #if canImport(UIKit)
        let device = UIDevice.current
        return FeedbackEnvironment(
            appVersion: bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown",
            build: bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown",
            osVersion: "\(device.systemName) \(device.systemVersion)",
            deviceModel: device.model
        )
        #else
        return FeedbackEnvironment(
            appVersion: bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown",
            build: bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown",
            osVersion: ProcessInfo.processInfo.operatingSystemVersionString,
            deviceModel: "unknown"
        )
        #endif
    }
}

public struct FeedbackDraft: Identifiable, Equatable, Sendable {
    public let id: UUID
    public let source: FeedbackSource
    public let createdAt: Date
    public let subject: String
    public let body: String

    public init(
        id: UUID = UUID(),
        source: FeedbackSource,
        createdAt: Date,
        subject: String,
        body: String
    ) {
        self.id = id
        self.source = source
        self.createdAt = createdAt
        self.subject = subject
        self.body = body
    }
}

public enum FeedbackDraftFactory {
    public static let supportAddress = "support@kolaleaf.com"

    public static func make(
        source: FeedbackSource,
        environment: FeedbackEnvironment,
        now: Date = Date()
    ) -> FeedbackDraft {
        let timestamp = ISO8601DateFormatter().string(from: now)
        let subject = "Kolaleaf app report"
        let body = """
        Please describe what happened:


        Diagnostics attached by Kolaleaf:
        - Source: \(source.rawValue)
        - App version: \(environment.appVersion) (\(environment.build))
        - OS: \(environment.osVersion)
        - Device: \(environment.deviceModel)
        - Time: \(timestamp)

        No screenshots, logs, account details, transfer IDs, phone numbers, or email addresses were attached automatically.
        """
        return FeedbackDraft(
            source: source,
            createdAt: now,
            subject: subject,
            body: body
        )
    }

    @MainActor
    public static func make(source: FeedbackSource) -> FeedbackDraft {
        make(source: source, environment: .current)
    }

    public static func mailtoURL(for draft: FeedbackDraft) -> URL? {
        var components = URLComponents()
        components.scheme = "mailto"
        components.path = supportAddress
        components.queryItems = [
            URLQueryItem(name: "subject", value: draft.subject),
            URLQueryItem(name: "body", value: draft.body),
        ]
        return components.url
    }
}
