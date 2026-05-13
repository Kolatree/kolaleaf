// LiveActivityStateMap.swift  (Phase 10A iter-2 · CA-1003 stub)
//
// Pure mapping from app-side `TransferStatus` to the widget-side
// `LiveActivityState` band. Lives APP-SIDE so Part B's
// `LiveActivityService` can unit-test the translation without
// spinning up a real `Activity`.
//
// Why stubbed now: Part A (this phase) only ships the attributes +
// surfaces. Naming the boundary here means the next phase doesn't
// inline the mapping into `LiveActivityService` and grow a duplicate
// switch. Part B (U71) fills in the body — see the mapping table on
// `LiveActivityState` in `KolaleafTransferAttributes.swift`.
//
// IMPORTANT: this file is NOT in the `KolaleafWidgets` target's source
// list. The widget extension does not know about `TransferStatus`.

import Foundation

/// Phase 10A iter-2 · CA-1003 stub.
///
// MARK: - Part B fills this in
//
// Expected signature (commented to keep the file compiling):
//
//   static func contentState(
//       from status: TransferStatus,
//       now: Date,
//       eta: ETAProvider
//   ) -> KolaleafTransferAttributes.ContentState
//
// The mapping table lives on `LiveActivityState`. CANCELLED / EXPIRED
// / REFUNDED have no corresponding ContentState — Part B's service
// MUST call `Activity.end(...)` for those bands instead of pushing a
// fresh state.
enum LiveActivityStateMap {
}
