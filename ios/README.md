# Kolaleaf iOS

Native SwiftUI iOS app. Variant C "The Send Gesture". Wave 2a.

## Setup

```bash
# Once: install XcodeGen + tooling
brew install xcodegen swiftlint

# Generate the .xcodeproj from project.yml
cd ios
xcodegen generate

# Open in Xcode
open Kolaleaf.xcodeproj
```

## Run on a simulator

```bash
xcodebuild -project ios/Kolaleaf.xcodeproj \
  -scheme Kolaleaf \
  -destination 'platform=iOS Simulator,name=iPhone 15 Pro,OS=17.2' \
  build
```

## Run tests

```bash
xcodebuild test \
  -project ios/Kolaleaf.xcodeproj \
  -scheme Kolaleaf \
  -destination 'platform=iOS Simulator,name=iPhone 15 Pro,OS=17.2'
```

## Environment variables

| Variable                | Purpose                                                     | Default                   |
| ----------------------- | ----------------------------------------------------------- | ------------------------- |
| `KOLA_API_BASE_URL`     | Backend base URL                                            | `https://kolaleaf.com.au` |
| `KOLA_RECORD_SNAPSHOTS` | Set to `1` to overwrite snapshot references during a CI run | unset                     |

## Folder layout

See `Kolaleaf/` for the source tree. Top-level groups:

- `App/` — `@main` entry, `RootCoordinator`, `AppState`
- `Design/` — tokens (colors, type, spacing, radius, motion) + view modifiers + primitives
- `Networking/` — `APIClient`, endpoints, DTOs, interceptors
- `Domain/` — models, services, state machine
- `Storage/` — Keychain wrapper, SwiftData stack
- `Features/` — one folder per screen-cluster (Onboarding, KYC, Send, …)
- `LiveActivities/` — shared with widget target
- `Resources/` — assets, fonts, string catalogs

## Reference

- Design source of truth: `~/.gstack/projects/Kolaleaf/designs/mobile-app-20260509/variant-C-journey.html`
- Tokens: `~/.gstack/projects/Kolaleaf/designs/mobile-app-20260509/approved.json` (mirrored at `Kolaleaf/Resources/Tokens.json`)
- Plan: `docs/plans/2026-05-09-001-feat-ios-swiftui-kolaleaf-mobile-app-plan.md`
- Backend API: `src/app/api/v1/*` (Next.js)

## Three Man Team

This iOS module follows the project's Arch / Bob / Richard workflow. See `BUILDER.md` and `REVIEWER.md` at repo root.
