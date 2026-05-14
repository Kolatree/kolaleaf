#!/usr/bin/env bash
# Kolaleaf · Xcode Cloud workflow bootstrap (U83)
#
# Uses the `asc` CLI to programmatically create two workflows:
#   1. pr-validate — test on PR
#   2. main-beta   — test + archive + TestFlight Internal on push to
#                    the development branch (feat/ios-swiftui-app
#                    pre-launch, flip to main post-launch)
#
# Prerequisites (UI-only — `asc` cannot create these via the official API):
#   A. App Store Connect app record for `com.kolaleaf.app` exists
#      (verify: `asc apps list | jq -r '.data[].attributes.bundleId'`
#       should include `com.kolaleaf.app`).
#   B. Xcode Cloud bootstrapped in Xcode: open the project, Product →
#      Xcode Cloud → Create Workflow. This creates the CiProduct +
#      connects GitHub via OAuth in one step. The default workflow
#      Xcode creates can be left as-is; this script will replace it.
#
# If either prereq fails, the script exits early with the specific
# step you need to do.
#
# Usage:
#   bash scripts/xcode-cloud-setup.sh                  # uses feat/ios-swiftui-app as the deploy branch
#   bash scripts/xcode-cloud-setup.sh main             # uses main
#   bash scripts/xcode-cloud-setup.sh --dry-run        # prints payloads without POSTing

set -euo pipefail

DEPLOY_BRANCH="${1:-feat/ios-swiftui-app}"
DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then DRY_RUN=1; DEPLOY_BRANCH="feat/ios-swiftui-app"; fi
if [[ "${2:-}" == "--dry-run" ]]; then DRY_RUN=1; fi

BUNDLE_ID="com.kolaleaf.app"
APP_NAME="Kolaleaf"

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
work_dir="$repo_root/.asc-workflow-payloads"
mkdir -p "$work_dir"

# -------------------------------------------------------------------
# Helpers
# -------------------------------------------------------------------
say()  { printf "\033[1;36m[xcode-cloud]\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m[xcode-cloud]\033[0m %s\n" "$*" >&2; }
die()  { printf "\033[1;31m[xcode-cloud]\033[0m %s\n" "$*" >&2; exit 1; }

require_cmd() { command -v "$1" >/dev/null 2>&1 || die "missing dependency: $1"; }
require_cmd asc
require_cmd jq

# -------------------------------------------------------------------
# Step 1 — auth sanity
# -------------------------------------------------------------------
say "verifying asc auth …"
if ! asc auth status >/dev/null 2>&1; then
  die "asc is not authenticated. Run \`asc auth status\` and \`asc auth login\` if needed."
fi

# -------------------------------------------------------------------
# Step 2 — prerequisite A: app record exists
# -------------------------------------------------------------------
say "looking up app record for $BUNDLE_ID …"
APP_ID="$(asc apps list --output json | jq -r --arg b "$BUNDLE_ID" '.data[] | select(.attributes.bundleId == $b) | .id' | head -n1)"
if [[ -z "$APP_ID" || "$APP_ID" == "null" ]]; then
  die "App Store Connect app record for $BUNDLE_ID not found.

Do this once in the browser (≈3 min):
  1. Open https://appstoreconnect.apple.com.
  2. My Apps → + → New App.
  3. Platform: iOS · Name: $APP_NAME · Primary language: English (Australia)
     · Bundle ID: $BUNDLE_ID · SKU: KOLALEAF-IOS-V1.
  4. User Access: Full Access.

Then re-run: bash scripts/xcode-cloud-setup.sh $DEPLOY_BRANCH"
fi
say "  app id: $APP_ID"

# -------------------------------------------------------------------
# Step 3 — prerequisite B: Xcode Cloud product + SCM connection
# -------------------------------------------------------------------
say "looking up Xcode Cloud product …"
CI_PRODUCT_ID="$(asc xcode-cloud products list --output json | jq -r --arg n "$APP_NAME" '.data[] | select(.attributes.name == $n) | .id' | head -n1)"
if [[ -z "$CI_PRODUCT_ID" || "$CI_PRODUCT_ID" == "null" ]]; then
  die "Xcode Cloud product for $APP_NAME not found.

Do this once in Xcode (≈3 min):
  1. Open ios/Kolaleaf.xcodeproj in Xcode.
  2. Product → Xcode Cloud → Create Workflow.
  3. Pick the Kolaleaf app target. Click Next.
  4. Grant Access → opens GitHub OAuth in a browser. Sign in with
     the Kolatree org owner account, approve the Xcode Cloud
     GitHub App for the Kolatree/Kolaleaf repository specifically.
  5. Confirm App Store Connect team = Kolatree Pty Ltd (XV85Z6GMF7).
  6. Click Next on the product-confirmation screen. Xcode creates
     a default workflow — you can leave it; this script replaces it.

Then re-run: bash scripts/xcode-cloud-setup.sh $DEPLOY_BRANCH"
fi
say "  product id: $CI_PRODUCT_ID"

say "looking up SCM repository …"
SCM_REPO_ID="$(asc xcode-cloud scm repositories list --output json 2>/dev/null | jq -r '.data[] | select(.attributes.repositoryName | test("[Kk]olaleaf")) | .id' | head -n1 || true)"
if [[ -z "$SCM_REPO_ID" || "$SCM_REPO_ID" == "null" ]]; then
  die "SCM repository for Kolaleaf not found in Xcode Cloud's SCM list.

This means the OAuth step in Xcode hasn't completed. Re-do
'Product → Xcode Cloud → Create Workflow' and finish the GitHub
authorization flow. Re-run this script when done."
fi
say "  repo id: $SCM_REPO_ID"

# -------------------------------------------------------------------
# Step 4 — look up latest Xcode + macOS versions
# -------------------------------------------------------------------
say "resolving latest Xcode + macOS versions …"
XCODE_VERSION_ID="$(asc xcode-cloud xcode-versions list --output json | jq -r '.data | sort_by(.attributes.name) | reverse | .[0].id')"
MACOS_VERSION_ID="$(asc xcode-cloud macos-versions list --output json | jq -r '.data | sort_by(.attributes.name) | reverse | .[0].id')"
say "  xcode: $XCODE_VERSION_ID"
say "  macos: $MACOS_VERSION_ID"

# -------------------------------------------------------------------
# Step 5 — workflow payloads
# -------------------------------------------------------------------
say "writing workflow payloads → $work_dir/ …"

# Shared action: test on the iPhone simulator pool. Apple's
# `destination` is a STRING enum (not an object); ANY_IOS_SIMULATOR
# picks the current default sim runner.
TEST_ACTION='{
  "actionType": "TEST",
  "name": "Test",
  "scheme": "Kolaleaf",
  "platform": "IOS",
  "isRequiredToPass": true,
  "testConfiguration": {
    "testDestinations": [
      {
        "kind": "SIMULATOR",
        "deviceTypeIdentifier": "com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro",
        "deviceTypeName": "iPhone 16 Pro",
        "runtimeIdentifier": "com.apple.CoreSimulator.SimRuntime.iOS-26-0",
        "runtimeName": "iOS 26.0"
      }
    ]
  }
}'

# Build action — used by pr-validate.
BUILD_ACTION='{
  "actionType": "BUILD",
  "name": "Build",
  "scheme": "Kolaleaf",
  "platform": "IOS",
  "isRequiredToPass": true,
  "destination": "ANY_IOS_SIMULATOR"
}'

# Archive action — used by main-beta. Archive runs against the
# `ANY_IOS_DEVICE` slice so Xcode Cloud produces a Distribution
# IPA suitable for TestFlight upload (signing via the managed
# certs Xcode Cloud creates against the Kolatree team).
ARCHIVE_ACTION='{
  "actionType": "ARCHIVE",
  "name": "Archive",
  "scheme": "Kolaleaf",
  "platform": "IOS",
  "isRequiredToPass": true,
  "destination": "ANY_IOS_DEVICE"
}'

# pr-validate — fires on every PR.
cat > "$work_dir/pr-validate.json" <<JSON
{
  "data": {
    "type": "ciWorkflows",
    "attributes": {
      "name": "pr-validate",
      "description": "Build + test on every pull request.",
      "isEnabled": true,
      "isLockedForEditing": false,
      "clean": false,
      "containerFilePath": "ios/Kolaleaf.xcodeproj",
      "pullRequestStartCondition": {
        "source": {"isAllMatch": true, "patterns": []},
        "destination": {"isAllMatch": true, "patterns": []},
        "autoCancel": true
      },
      "actions": [$BUILD_ACTION, $TEST_ACTION]
    },
    "relationships": {
      "product":      { "data": { "type": "ciProducts",      "id": "$CI_PRODUCT_ID"      } },
      "repository":   { "data": { "type": "scmRepositories", "id": "$SCM_REPO_ID"        } },
      "xcodeVersion": { "data": { "type": "ciXcodeVersions", "id": "$XCODE_VERSION_ID"   } },
      "macOsVersion": { "data": { "type": "ciMacOsVersions", "id": "$MACOS_VERSION_ID"   } }
    }
  }
}
JSON

# main-beta — fires on push to the deploy branch.
cat > "$work_dir/main-beta.json" <<JSON
{
  "data": {
    "type": "ciWorkflows",
    "attributes": {
      "name": "main-beta",
      "description": "Test + archive + TestFlight Internal on every push to $DEPLOY_BRANCH.",
      "isEnabled": true,
      "isLockedForEditing": false,
      "clean": false,
      "containerFilePath": "ios/Kolaleaf.xcodeproj",
      "branchStartCondition": {
        "source": {"isAllMatch": false, "patterns": [{"isAllMatch": false, "patternType": "EXACT_MATCH", "pattern": "$DEPLOY_BRANCH"}]},
        "files": {"isAllMatch": true, "patterns": []},
        "autoCancel": true
      },
      "actions": [$TEST_ACTION, $ARCHIVE_ACTION]
    },
    "relationships": {
      "product":      { "data": { "type": "ciProducts",      "id": "$CI_PRODUCT_ID"      } },
      "repository":   { "data": { "type": "scmRepositories", "id": "$SCM_REPO_ID"        } },
      "xcodeVersion": { "data": { "type": "ciXcodeVersions", "id": "$XCODE_VERSION_ID"   } },
      "macOsVersion": { "data": { "type": "ciMacOsVersions", "id": "$MACOS_VERSION_ID"   } }
    }
  }
}
JSON

say "  $work_dir/pr-validate.json"
say "  $work_dir/main-beta.json"

if [[ $DRY_RUN -eq 1 ]]; then
  say "--dry-run: payloads written but not POSTed. exiting."
  exit 0
fi

# -------------------------------------------------------------------
# Step 6 — replace existing workflows
# -------------------------------------------------------------------
say "checking for existing workflows on the product …"
EXISTING="$(asc xcode-cloud workflows list --app "$APP_ID" --output json | jq -r '.data[] | {id: .id, name: .attributes.name} | @json')"
if [[ -n "$EXISTING" ]]; then
  echo "$EXISTING" | while read -r row; do
    id="$(echo "$row" | jq -r .id)"
    name="$(echo "$row" | jq -r .name)"
    if [[ "$name" == "pr-validate" || "$name" == "main-beta" ]]; then
      say "  deleting existing workflow named '$name' ($id)"
      asc xcode-cloud workflows delete --id "$id" >/dev/null
    else
      warn "  leaving existing workflow '$name' ($id) alone — rename or delete in UI if not wanted."
    fi
  done
fi

# -------------------------------------------------------------------
# Step 7 — create the two workflows
# -------------------------------------------------------------------
say "creating workflow pr-validate …"
pr_id="$(asc xcode-cloud workflows create --file "$work_dir/pr-validate.json" --output json | jq -r '.data.id')"
say "  ✅ pr-validate → $pr_id"

say "creating workflow main-beta …"
main_id="$(asc xcode-cloud workflows create --file "$work_dir/main-beta.json" --output json | jq -r '.data.id')"
say "  ✅ main-beta → $main_id"

# -------------------------------------------------------------------
# Done
# -------------------------------------------------------------------
say "all done. workflows live at https://appstoreconnect.apple.com/teams/$(echo $APP_ID | head -c8)/apps/$APP_ID/xcode-cloud"
say ""
say "next steps:"
say "  - push a small commit to $DEPLOY_BRANCH → main-beta fires"
say "  - open a PR → pr-validate fires"
say "  - tail the first run: asc xcode-cloud build-runs --workflow-id $main_id --output table"
