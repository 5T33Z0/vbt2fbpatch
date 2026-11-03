#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
TMP_EXEC="$(mktemp -t vbt-native-test)"
trap 'rm -f "$TMP_EXEC"' EXIT
xcrun swiftc -swift-version 5 \
  VBT2FBPatch/Core/VBTParser.swift \
  VBT2FBPatch/Core/PatchGenerator.swift \
  VBT2FBPatch/Core/IGPUCompatibility.swift \
  Tests/NativeSmokeTests.swift -o "$TMP_EXEC"
"$TMP_EXEC" source/samples
