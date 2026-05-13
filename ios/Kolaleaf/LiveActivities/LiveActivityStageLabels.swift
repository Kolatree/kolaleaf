// LiveActivityStageLabels.swift  (Phase 10B iter-2 · CA-2008)
//
// Operational copy that names the current step of an in-flight
// transfer. Pulled out of `LiveActivityService.swift` into its own
// file so the lint sweep + a future copy-localisation pass can find
// every label in one place.
//
// Treasury-internal vocabulary is forbidden — see
// `LiveActivityCopyLint.forbidden`. Every label is run through
// `LiveActivityCopyLint.sanitized(_:)` which redacts forbidden words
// in BOTH Debug and Release. The DEBUG `assertionFailure` inside
// `assertNotForbidden(_:)` continues to fire so dev builds catch the
// regression at the source.
//
// File lives APP-SIDE — `TransferStatus` is an app-target type. This
// file MUST NOT be added to the `KolaleafWidgets` target's source list.

import Foundation

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
        // sanitized(_:) is the Release-safe form. It calls
        // assertNotForbidden(_:) under the hood so dev builds still
        // trip loudly when a label regresses, but production builds
        // scrub user-controllable input that smuggled in a forbidden
        // word (e.g. recipient name "Float Liquidity Holdings Ltd").
        return LiveActivityCopyLint.sanitized(raw)
    }
}
