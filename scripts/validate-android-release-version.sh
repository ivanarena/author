#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
gradle_file="${repo_root}/apps/android/app/build.gradle.kts"
release_tag="${1:-${RELEASE_TAG:-}}"

fail() {
  printf 'Android release version check failed: %s\n' "$1" >&2
  exit 1
}

extract_version_name() {
  sed -nE 's/^[[:space:]]*versionName = "([^"]+)".*$/\1/p' "$1" | head -n 1
}

extract_version_code() {
  sed -nE 's/^[[:space:]]*versionCode = ([0-9]+).*$/\1/p' "$1" | head -n 1
}

normalize_version_tag() {
  local raw="${1#refs/tags/}"
  raw="${raw#author-}"
  raw="${raw#android-}"
  raw="${raw#v}"
  [[ "$raw" =~ ^[0-9]+(\.[0-9]+){1,2}$ ]] || return 1
  printf '%s\n' "$raw"
}

version_key() {
  local version="$1"
  local major minor patch
  IFS=. read -r major minor patch <<<"$version"
  patch="${patch:-0}"
  printf '%05d.%05d.%05d\n' "$major" "$minor" "$patch"
}

version_name="$(extract_version_name "$gradle_file")"
version_code="$(extract_version_code "$gradle_file")"

[[ -n "$version_name" ]] || fail "could not read versionName from ${gradle_file}"
[[ -n "$version_code" ]] || fail "could not read versionCode from ${gradle_file}"

if [[ -n "$release_tag" ]]; then
  expected_version="$(normalize_version_tag "$release_tag")" ||
    fail "release tag ${release_tag} is not a supported version tag"
  [[ "$version_name" == "$expected_version" ]] ||
    fail "versionName ${version_name} does not match release tag ${release_tag}"
fi

mapfile -t version_tags < <(
  git -C "$repo_root" tag --list 'v[0-9]*' |
    while IFS= read -r tag; do
      if normalized="$(normalize_version_tag "$tag")"; then
        printf '%s %s\n' "$(version_key "$normalized")" "$tag"
      fi
    done |
    sort
)

head_matches_version=false
while IFS= read -r head_tag; do
  if normalized="$(normalize_version_tag "$head_tag")" &&
    [[ "$normalized" == "$version_name" ]]; then
    head_matches_version=true
    break
  fi
done < <(git -C "$repo_root" tag --points-at HEAD --list 'v[0-9]*')

current_key="$(version_key "$version_name")"
previous_code=0
previous_tag=""
previous_version=""
latest_key=""
latest_tag=""
latest_version=""

for entry in "${version_tags[@]}"; do
  key="${entry%% *}"
  tag="${entry#* }"
  normalized="$(normalize_version_tag "$tag")"
  latest_key="$key"
  latest_tag="$tag"
  latest_version="$normalized"
  if [[ "$key" < "$current_key" ]]; then
    tagged_file="$(git -C "$repo_root" show "${tag}:apps/android/app/build.gradle.kts" 2>/dev/null || true)"
    tagged_code="$(printf '%s\n' "$tagged_file" |
      sed -nE 's/^[[:space:]]*versionCode = ([0-9]+).*$/\1/p' |
      head -n 1)"
    if [[ -n "$tagged_code" ]]; then
      previous_code="$tagged_code"
      previous_tag="$tag"
      previous_version="$normalized"
    fi
  fi
done

if [[ -n "$latest_key" && "$head_matches_version" != true ]]; then
  [[ "$current_key" > "$latest_key" ]] ||
    fail "versionName ${version_name} must be newer than latest tag ${latest_tag} (${latest_version}) before tagging a new release"
fi

if [[ "$previous_code" -gt 0 ]]; then
  [[ "$version_code" -gt "$previous_code" ]] ||
    fail "versionCode ${version_code} must be greater than ${previous_code} from ${previous_tag}"
fi

printf 'Android release version ok: versionName=%s versionCode=%s\n' \
  "$version_name" "$version_code"
