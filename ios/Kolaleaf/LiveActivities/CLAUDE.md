# LiveActivities/

Files here are shared with the `KolaleafWidgets` target via
`project.yml`'s widget sources list. Do NOT add app-only imports
(UIKit, app-target Domain types, app-only frameworks). Anything
compiled in here ends up in the widget process (~30 MB hard cap before
iOS kills the extension).

Part A (Phase 10A): `KolaleafTransferAttributes.swift` only — shared.

Part B (Phase 10B / U71): `LiveActivityStateMap.swift` is APP-ONLY. It
imports the app-target `TransferStatus` to translate to the widget's
`LiveActivityState`. It MUST NOT be added to the widget sources.
