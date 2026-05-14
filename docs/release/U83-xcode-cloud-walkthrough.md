# U83 — Xcode Cloud workflow walkthrough

You've signed into Xcode with the Kolaleaf-authorised Apple ID and
`ios/ci_scripts/ci_post_clone.sh` is committed. The `asc` CLI handles
the workflow creation programmatically (it hits the official ASC REST
API at `/v1/ciWorkflows`); Apple still gates two prerequisites
behind the UI because there's no official API for them:

1. **App Store Connect app record creation** for `com.kolaleaf.app`
   (browser, ≈3 min).
2. **Xcode Cloud bootstrap** in Xcode — connects GitHub via OAuth
   and registers the Xcode Cloud product (Xcode, ≈3 min).

After those two clicks, **one command creates both workflows**:

```bash
bash scripts/xcode-cloud-setup.sh
```

Two workflows the script creates:

| Workflow        | Trigger                                                        | Actions                       | Distribution          |
| --------------- | -------------------------------------------------------------- | ----------------------------- | --------------------- |
| **pr-validate** | Pull Request → any branch                                      | Build + Test on iPhone 16 Pro | None (validates only) |
| **main-beta**   | Branch change → `feat/ios-swiftui-app` (or `main` post-launch) | Test → Archive                | TestFlight Internal   |

Total time: **≈8 minutes** (6 min for the two UI steps, plus the
script run which takes seconds).

The fallback at the bottom of this doc is the pure-UI walkthrough
(no `asc` involvement) in case the CLI path breaks.

---

## One-time Xcode Cloud onboarding (first workflow only)

You should already be in `ios/Kolaleaf.xcodeproj` in Xcode.

1. **Product → Xcode Cloud → Create Workflow…**
   - If you see "Get Started with Xcode Cloud" instead, this is the
     onboarding screen. Click **Get Started**.

2. **Select the app target.** Xcode lists every target it sees. Pick
   **Kolaleaf** (the app target, not the widgets target). Click
   **Next**.

3. **Grant repository access.**
   - Xcode prompts: "Xcode Cloud needs access to your source
     repository."
   - Click **Grant Access**. A browser window opens to GitHub.
   - Sign in with the Kolatree GitHub org owner (or any org member with
     repo admin rights).
   - Approve the **Xcode Cloud** GitHub App for the
     `Kolatree/Kolaleaf` repository specifically (not "all
     repositories" — least-privilege).
   - Browser returns you to Xcode automatically.

4. **Confirm the team.** Xcode shows the App Store Connect team picker.
   Pick **Acuoos Pty Ltd (5VCH6937XM)**. Click **Next**.

5. **Confirm the product creation.** Xcode shows a summary: the
   product name ("Kolaleaf"), the bundle ID (`com.kolaleaf.app`), and
   the repository (`github.com/Kolatree/Kolaleaf`). Click **Next**.

Now you're on the workflow editor — proceed to **Workflow 1**
below.

---

## Workflow 1 — `pr-validate`

The default workflow Apple creates is usually called "Workflow" and
triggers on the main branch. Reconfigure it as the pull-request
validator.

1. **Workflow name** → rename to `pr-validate`.

2. **General → Description** → `Build + test on every pull request.`

3. **Environment → Xcode Version** → `Xcode 16.x (Latest Release)`.

4. **Environment → macOS Version** → `macOS 14 (Latest Release)`.

5. **Start Conditions** — remove any existing branch condition. Add:
   - Click **+ → Pull Request Changes**.
   - **Source Branches** → `Any`.
   - **Target Branches** → `Any`.
   - **Files and Folders** → leave blank (every change triggers).
   - **Auto-cancel Builds** → ✅ enable (cancels superseded builds).

6. **Actions** — Apple adds a Build action by default. Reconfigure:
   - **Build (existing):**
     - Scheme: `Kolaleaf`.
     - Platform: `iOS`.
     - Configuration: `Debug`.
     - Destination: `Recommended Destinations`.
   - **+ Test:**
     - Scheme: `Kolaleaf`.
     - Platform: `iOS`.
     - Destinations: select **iPhone 16 Pro** + **iPhone SE (3rd
       generation)**.
     - **Required to Pass** → ✅ enable.
     - **Test Plan** → `Kolaleaf` (the default plan; if you have a
       narrower CI plan, pick that).

7. **Post-Actions** — leave empty. PR builds don't distribute.

8. **Notifications:**
   - **Build Failure** → ✅ Email pull request author + reviewers.
   - **Build Success** → leave off (avoids noise on every PR).

9. **Save**. The first build kicks off automatically once a new PR
   targets a branch covered by the rule.

---

## Workflow 2 — `main-beta`

1. **Workflow → + Add Workflow** (top right of the workflow list).

2. **Workflow name** → `main-beta`.

3. **General → Description** → `Archive + upload to TestFlight Internal on every push to feat/ios-swiftui-app (rename to main on launch).`

4. **Environment** → same as `pr-validate` (Xcode latest, macOS
   latest).

5. **Start Conditions:**
   - **+ → Branch Changes**.
   - **Source Branches** → for pre-launch, set to
     `feat/ios-swiftui-app`. After launch, change to `main`.
   - **Files and Folders** → leave blank.
   - **Auto-cancel Builds** → ✅ enable.

6. **Actions:**
   - **+ Test:** same config as `pr-validate` (scheme Kolaleaf,
     iPhone 16 Pro + iPhone SE 3rd, Required to Pass).
   - **+ Archive:** - Scheme: `Kolaleaf`. - Platform: `iOS`. - **Deployment Preparation** → `TestFlight (Internal Testing
Only)`. - **Distribution Preparation** → ✅ Sign and Notarize (Xcode
     Cloud manages the cert + provisioning).

7. **Post-Actions:**
   - **TestFlight Internal Testing** is added automatically by the
     Archive action. Verify it's there.
   - **+ Notify** (optional) → if you have a Slack webhook for
     `#kolaleaf-builds`, add it here.

8. **Notifications:**
   - **Build Failure** → ✅ Email yourself + the team.
   - **Build Success** → ✅ Email yourself only (so you know TestFlight
     processing is in progress).

9. **Save**.

---

## Verify

Push a small commit to `feat/ios-swiftui-app` (or merge an open PR
to test `pr-validate`). Within ~60s the workflow appears in **Xcode →
Report Navigator → Xcode Cloud** with status `Running`.

First builds usually take 15-25 min (cold cache). Subsequent runs are
~8-12 min once Apple caches the dependencies.

Verify `ci_post_clone.sh` runs by inspecting the build log under
**Xcode Cloud → (your build) → Build → Logs**. You should see:

- `xcodegen` install (first run only) + invocation.
- `xcodebuild` proceeds against the regenerated project.

---

## Troubleshooting

### "Workflow failed: scheme not found"

`ci_post_clone.sh` didn't run, OR `project.yml` doesn't generate the
`Kolaleaf` scheme. Test locally:

```bash
cd ios && ./ci_scripts/ci_post_clone.sh
ls Kolaleaf.xcodeproj/xcshareddata/xcschemes/
# Must contain: Kolaleaf.xcscheme
```

If the scheme is missing, the project's schemes are not set to
"Shared" in `project.yml`. Add to the scheme definition:

```yaml
schemes:
  Kolaleaf:
    shared: true
```

### "Code signing failed"

Xcode Cloud manages signing automatically when `Distribution
Preparation → Sign and Notarize` is enabled. If signing fails:

- Confirm the App Store Connect team in the workflow is **Acuoos Pty
  Ltd (5VCH6937XM)**.
- Confirm the bundle ID `com.kolaleaf.app` is registered in Apple
  Developer → Identifiers under the same team.
- Re-run the workflow. Xcode Cloud's cert provisioning is automatic
  on retry.

### "Brew install xcodegen failed"

The post-clone script tries `brew install xcodegen` on the build
runner. Apple's runners have brew pre-installed but no network
ratelimiting. If you see "Permission denied" or a rate-limit error,
swap to the `mint` install path:

```bash
# In ci_scripts/ci_post_clone.sh
if ! command -v xcodegen >/dev/null 2>&1; then
  # Fallback when brew is rate-limited
  curl -L https://github.com/yonaskolb/XcodeGen/releases/latest/download/xcodegen.artifactbundle.zip -o /tmp/xcg.zip
  unzip -o /tmp/xcg.zip -d /tmp
  export PATH="/tmp/xcodegen.artifactbundle/xcodegen-bin/bin:$PATH"
fi
```

### Internal testers don't see new builds

After `main-beta` lands a build:

1. **App Store Connect → TestFlight → Builds** should show the new
   build with status `Processing`.
2. Processing takes 15-30 min. Once it flips to `Ready to Test`,
   internal testers see it in the TestFlight iOS app immediately.
3. If processing hangs >2h, the build was rejected. Check the
   ITC Reject email (sent to the team agent + you) for the
   reason.

---

## Programmatic workflow changes (after onboarding)

Once Xcode Cloud is connected to the repo, you can edit workflows
via the App Store Connect API instead of the UI. Useful for:

- Bulk updates ("rename main-beta's source branch from
  feat/ios-swiftui-app to main").
- Adding new workflows from CI (e.g., a nightly performance test).
- Disabling workflows for a release-freeze window.

The relevant ASC API endpoints:

- `GET /v1/ciProducts` — list registered products.
- `GET /v1/scmRepositories?filter[ciProducts]={product_id}` — list
  connected repos for a product.
- `GET /v1/ciWorkflows?filter[product]={product_id}` — list
  workflows.
- `PATCH /v1/ciWorkflows/{id}` — edit a workflow.
- `POST /v1/ciWorkflows` — create a new workflow.

Auth is the same App Store Connect API key as the TestFlight
fastlane setup — `ASC_KEY_ID` + `ASC_ISSUER_ID` +
`ASC_KEY_FILEPATH` env vars (see `docs/release/U85-testflight-walkthrough.md`).

I haven't shipped a wrapper script for this yet — the manual UI
edits cover today's needs. If/when bulk workflow management
becomes operationally annoying, I can add `scripts/xcode-cloud-workflows.py`
with the create/list/patch surface.
