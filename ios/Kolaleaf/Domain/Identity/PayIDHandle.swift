// PayIDHandle.swift  (Phase 7 iter-2 · W5 / CA-004)
// Domain type for the user's standing PayID handle (Account → My
// PayID). Distinct from `Transfer.payidProviderRef` — that's the
// transient address generated per-transfer by Monoova for the user
// to push AUD into; this is the user-owned identifier returned by
// `/account/me` once the backend ships per-user allocation.
//
// As of Phase 7 the backend does NOT return an allocated handle.
// `Source.allocated` is the only constructor today; the View shows
// `.unavailable` everywhere else. When the backend ships additional
// handle types (phone, ABN, organisation), add new `Source` cases
// here so the View can branch on provenance.

import Foundation

public struct PayIDHandle: Equatable, Sendable, Hashable {
    public let value: String
    public let source: Source

    public enum Source: String, Equatable, Sendable, Hashable {
        /// Backend-allocated PayID, owned by the user. Will eventually
        /// be returned by `/account/me` as `payidHandle` (TBD).
        case allocated
    }

    public init(value: String, source: Source) {
        self.value = value
        self.source = source
    }
}
