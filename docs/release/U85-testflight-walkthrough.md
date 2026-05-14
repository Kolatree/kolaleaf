# U85/U86/U87 — TestFlight Internal → Feedback → External walkthrough

This is the one-page on-ramp for taking Kolaleaf from a green local build
to TestFlight and onwards. It assumes `fastlane` is installed (it is —
`/Users/ao/.rbenv/shims/fastlane`) and you have access to the Acuoos Pty
Ltd App Store Connect account.

## Prerequisites (one-time)

### 1. App record in App Store Connect

If the bundle ID `com.kolaleaf.app` doesn't already have an app record:

1. Log in to https://appstoreconnect.apple.com.
2. **My Apps → "+" → New App.**
3. Platform: **iOS**.
4. Name: **Kolaleaf**.
5. Primary language: **English (Australia)**.
6. Bundle ID: select **com.kolaleaf.app** (must already exist in
   Apple Developer → Identifiers; the project.yml says
   `DEVELOPMENT_TEAM: "5VCH6937XM"` so use that team).
7. SKU: e.g. `KOLALEAF-IOS-V1`.
8. User Access: **Full Access**.

### 2. App Store Connect API key

Preferred over username/password auth. One-time setup:

1. https://appstoreconnect.apple.com → **Users and Access → Keys**.
2. **App Store Connect API → +** to create a key.
3. Name: `Kolaleaf · fastlane`. Access: **App Manager** (Developer is too narrow for TestFlight uploads).
4. **Download** the `.p8` file. **It can only be downloaded once.**
5. Move it somewhere stable — recommended:
   ```bash
   mkdir -p ~/.asc-keys
   mv ~/Downloads/AuthKey_*.p8 ~/.asc-keys/
   chmod 600 ~/.asc-keys/AuthKey_*.p8
   ```
6. Note the **Key ID** (next to the key in the console) and the
   **Issuer ID** (above the keys table).

Export these env vars (add to `~/.zshrc` for persistence):

```bash
export ASC_KEY_ID="ABCDE12345"
export ASC_ISSUER_ID="00000000-0000-0000-0000-000000000000"
export ASC_KEY_FILEPATH="$HOME/.asc-keys/AuthKey_ABCDE12345.p8"
```

### 3. Distribution signing assets

The release archive needs a **Distribution certificate** and an
**App Store provisioning profile**. Easiest path:

1. Open `ios/Kolaleaf.xcodeproj` in Xcode.
2. **Targets → Kolaleaf → Signing & Capabilities.**
3. Team: **Acuoos Pty Ltd (5VCH6937XM)**.
4. Check **Automatically manage signing**.
5. Xcode will fetch the Distribution cert + App Store profile on the
   first archive attempt; sign in to your Apple ID if it prompts.

If you'd rather use `match` to manage certs in a private git repo,
uncomment the `match(type: "appstore")` line in `ios/fastlane/Fastfile`'s
`beta` lane and run `bundle exec fastlane match appstore` once to
seed the cert pool.

### 4. Internal tester group

In App Store Connect → **TestFlight → Internal Testing**, add yourself

- the 5 friendly users from the plan as internal testers (15-tester cap;
  no Beta App Review). They appear in the iOS TestFlight app once a build
  processes (usually 15-30 min after upload).

## Running it (every release)

### Local sanity check

```bash
cd /Users/ao/Documents/projects/Kolaleaf/ios
bundle exec fastlane ios pre_flight
```

This runs `xcodegen generate` + the focused test suites the orchestrator
has been running this session. ~60s. If anything's red, fix before
shipping.

### TestFlight Internal upload (U85)

```bash
cd /Users/ao/Documents/projects/Kolaleaf/ios
bundle exec fastlane ios beta
```

What happens:

1. `xcodegen generate` regenerates `Kolaleaf.xcodeproj`.
2. `build_app` archives + exports a Release IPA into `ios/build/`.
3. `upload_to_testflight` ships to App Store Connect.
4. fastlane polls until the build finishes processing (~15-30 min).
5. Build appears under **TestFlight → Builds**; internal testers can
   install via the TestFlight app immediately after processing.

You can override the changelog:

```bash
KOLA_TESTFLIGHT_CHANGELOG="Phone-first onboarding · backend dual-rail · review gate scaffold (off)" \
  bundle exec fastlane ios beta
```

### Collect feedback (U86)

Per the plan, run an internal beta for ~5 days. Track issues against
the GitHub board (or wherever you prefer — `tasks/lessons.md` if
single-developer). Categorise as P0 / P1 / P2; fix P0 + P1 in this
slot, defer P2 to v1.0.1.

### Promote to External beta (U87)

Once internal feedback is addressed and you have your 100-tester
external group set up in App Store Connect:

```bash
cd /Users/ao/Documents/projects/Kolaleaf/ios
KOLA_TESTFLIGHT_CHANGELOG="External beta — phone-first onboarding ready for end-to-end testing." \
  bundle exec fastlane ios beta_external
```

This promotes the **latest** TestFlight build in the version train. If
you want a specific build, override:

```bash
KOLA_VERSION="1.0" bundle exec fastlane ios beta_external
```

The first external promotion triggers **Beta App Review** by Apple
(usually 24-48h on first submission, shorter on subsequent ones).
Public TestFlight link surfaces in App Store Connect →
**TestFlight → External Groups → Public Link** once approved.

## Troubleshooting

### "No Distribution certificate found"

Run inside Xcode once: **Product → Archive**. Let Xcode create the
cert. Cancel the archive. Then `fastlane ios beta` will pick it up.

### "ITMS-90208: Invalid Bundle. The bundle did not contain ..."

xcodegen didn't include a target's resources. Check `ios/project.yml`
against the diff and re-run `xcodegen generate`.

### "App Store Connect API rate limited"

You exported the same build number twice. The Fastfile uses
`latest_testflight_build_number + 1` to avoid this — if it failed,
manually set:

```bash
agvtool new-version -all 42  # or whatever's next
```

### "Build processing stuck"

App Store Connect occasionally takes >1 hour. If it's been more than
24h, the build was likely rejected by ITC validation; check
**TestFlight → Builds → (your build) → status** for the rejection
reason.

### Fallback: `xcrun altool` (Apple's stock uploader)

If fastlane's misbehaving, you can still upload manually:

```bash
xcodebuild archive \
  -project ios/Kolaleaf.xcodeproj \
  -scheme Kolaleaf \
  -configuration Release \
  -archivePath ios/build/archive/Kolaleaf.xcarchive

xcodebuild -exportArchive \
  -archivePath ios/build/archive/Kolaleaf.xcarchive \
  -exportPath ios/build/export \
  -exportOptionsPlist ios/build/export-options.plist
  # (export-options.plist is a property list with method=app-store)

xcrun altool --upload-app \
  -f ios/build/export/Kolaleaf.ipa \
  -t ios \
  --apiKey "$ASC_KEY_ID" \
  --apiIssuer "$ASC_ISSUER_ID"
```

Slower than fastlane but uses Apple's own tooling end-to-end.
