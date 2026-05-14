// AnalyticsEndpoints.swift  (Phase 11.6 · U89)
// First-party, privacy-bounded KPI event endpoint declarations.

import Foundation

public enum AnalyticsPropertyValue: Codable, Equatable, Sendable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Int.self) {
            self = .int(value)
        } else if let value = try? container.decode(Double.self) {
            self = .double(value)
        } else {
            self = .string(try container.decode(String.self))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value):
            try container.encode(value)
        case .int(let value):
            try container.encode(value)
        case .double(let value):
            try container.encode(value)
        case .bool(let value):
            try container.encode(value)
        }
    }
}

public enum AnalyticsEvent: String, Codable, Sendable, CaseIterable, Hashable {
    case welcomeShown = "welcome_shown"
    case phoneOtpStarted = "phone_otp_started"
    case phoneOtpCompleted = "phone_otp_completed"
    case emailOtpStarted = "email_otp_started"
    case emailOtpCompleted = "email_otp_completed"
    case kycStarted = "kyc_started"
    case kycCompleted = "kyc_completed"
    case recipientAdded = "recipient_added"
    case sendScreenViewed = "send_screen_viewed"
    case amountEntered = "amount_entered"
    case recipientSelected = "recipient_selected"
    case slideInitiated = "slide_initiated"
    case slideThresholdReached = "slide_threshold_reached"
    case slideAbandoned = "slide_abandoned"
    case faceIDPromptPresented = "faceid_prompt_presented"
    case faceIDSucceeded = "faceid_succeeded"
    case transferPostSucceeded = "transfer_post_succeeded"
    case payIDCopied = "payid_copied"
    case transferCompleted = "transfer_completed"
    case receiptShared = "receipt_shared"
    case receiptShareConsentShown = "receipt_share_consent_shown"
    case referralCaptured = "referral_captured"
    case tapSendChosen = "tap_send_chosen"
}

public struct AnalyticsEventRequest: Codable, Equatable, Sendable {
    public let event: AnalyticsEvent
    public let occurredAt: Date
    public let properties: [String: AnalyticsPropertyValue]

    public init(
        event: AnalyticsEvent,
        occurredAt: Date,
        properties: [String: AnalyticsPropertyValue]
    ) {
        self.event = event
        self.occurredAt = occurredAt
        self.properties = properties
    }
}

public enum AnalyticsEndpoints {
    public struct Track: Endpoint {
        public typealias Response = EmptyResponse
        public let path = "/api/v1/analytics/events"
        public let method: HTTPMethod = .post
        public let body: (any Encodable & Sendable)?

        public init(_ request: AnalyticsEventRequest) {
            self.body = request
        }
    }
}
