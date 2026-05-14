#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
IOS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if ! command -v xcodegen >/dev/null 2>&1; then
  brew install xcodegen
fi

cd "$IOS_DIR"
xcodegen generate
