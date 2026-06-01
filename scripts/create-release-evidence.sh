#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

release_id="${1:-}"
if [[ -z "$release_id" ]]; then
  release_id="$(git describe --tags --exact-match 2>/dev/null || git rev-parse --short HEAD)"
fi

safe_release_id="${release_id//\//-}"
output="docs/releases/${safe_release_id}.md"

if [[ -e "$output" ]]; then
  echo "Release evidence already exists: $output" >&2
  exit 1
fi

escape_sed() {
  printf '%s' "$1" | sed -e 's/[\/&]/\\&/g'
}

commit_sha="$(git rev-parse HEAD)"
branch="$(git branch --show-current 2>/dev/null || true)"
date_utc="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
android_version_name="$(
  sed -n 's/^[[:space:]]*versionName = "\([^"]*\)".*/\1/p' apps/android/app/build.gradle.kts
)"
android_version_code="$(
  sed -n 's/^[[:space:]]*versionCode = \([0-9][0-9]*\).*/\1/p' apps/android/app/build.gradle.kts
)"

mkdir -p docs/releases
tmp="$(mktemp)"
sed \
  -e "s/{{RELEASE_ID}}/$(escape_sed "$release_id")/g" \
  -e "s/{{DATE_UTC}}/$(escape_sed "$date_utc")/g" \
  -e "s/{{COMMIT_SHA}}/$(escape_sed "$commit_sha")/g" \
  -e "s/{{BRANCH}}/$(escape_sed "${branch:-detached}")/g" \
  -e "s/{{ANDROID_VERSION_NAME}}/$(escape_sed "$android_version_name")/g" \
  -e "s/{{ANDROID_VERSION_CODE}}/$(escape_sed "$android_version_code")/g" \
  docs/release-evidence-template.md >"$tmp"
mv "$tmp" "$output"

echo "Created $output"
