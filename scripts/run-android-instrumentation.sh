#!/usr/bin/env bash
set -euo pipefail

app_apk="${1:-}"
test_apk="${2:-}"
result_file="${3:-android-instrumentation.txt}"

if [[ ! -f "$app_apk" || ! -f "$test_apk" ]]; then
  echo "Usage: $0 <app-debug.apk> <app-debug-androidTest.apk> [result-file]" >&2
  exit 2
fi

adb uninstall com.author >/dev/null 2>&1 || true
adb install -g "$app_apk" >/dev/null
adb install -t "$test_apk" >/dev/null

set +e
adb shell am instrument -w -r \
  com.author.test/androidx.test.runner.AndroidJUnitRunner \
  2>&1 | tee "$result_file"
instrumentation_status=${PIPESTATUS[0]}
set -e

if [[ "$instrumentation_status" -ne 0 ]] || \
  grep -Eq 'FAILURES!!!|INSTRUMENTATION_FAILED|Process crashed' "$result_file" || \
  ! grep -Eq '^OK \([0-9]+ tests?\)' "$result_file"; then
  echo "Android instrumentation tests failed" >&2
  exit 1
fi
