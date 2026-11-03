#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
APP="${1:-dist/VBT2FBPatch.app}"
if [ ! -d "$APP" ]; then
    echo "App bundle not found: $APP" >&2
    exit 1
fi
TEMP_EXEC="$(mktemp -t vbt-l10n-test)"
trap 'rm -f "$TEMP_EXEC"' EXIT
xcrun swiftc -swift-version 5 VBT2FBPatch/Core/AppLocalization.swift Tests/LocalizationTests.swift -o "$TEMP_EXEC"
"$TEMP_EXEC" "$APP"
