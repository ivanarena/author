#!/usr/bin/env bash
set -euo pipefail

commit_sha="${1:-${GITHUB_SHA:-}}"
if [[ -z "$commit_sha" ]]; then
  echo "Usage: $0 <main-commit-sha>" >&2
  exit 2
fi
if [[ -z "${GITHUB_OUTPUT:-}" ]]; then
  echo "GITHUB_OUTPUT is required" >&2
  exit 2
fi

write_result() {
  local reusable="$1"
  local source_sha="$2"
  local reason="$3"
  {
    echo "reusable=$reusable"
    echo "source_sha=$source_sha"
    echo "reason=$reason"
  } >>"$GITHUB_OUTPUT"
  printf 'Reviewed-source reuse: %s (%s)\n' "$reusable" "$reason"
}

if [[ "${GITHUB_EVENT_NAME:-}" != push || "${GITHUB_REF:-}" != refs/heads/main ]]; then
  write_result false "" "not a main-branch push"
  exit 0
fi
if [[ -z "${GITHUB_REPOSITORY:-}" ]]; then
  write_result false "" "GITHUB_REPOSITORY is unavailable"
  exit 0
fi
if ! command -v gh >/dev/null || ! command -v jq >/dev/null; then
  write_result false "" "required GitHub tooling is unavailable"
  exit 0
fi

pulls="$(gh api "repos/${GITHUB_REPOSITORY}/commits/${commit_sha}/pulls" 2>/dev/null || true)"
if [[ -z "$pulls" ]]; then
  write_result false "" "no merged pull request was found"
  exit 0
fi

matching_pulls="$(
  jq --arg sha "$commit_sha" \
    '[.[] | select(.merged_at != null and .merge_commit_sha == $sha)]' \
    <<<"$pulls"
)"
if [[ "$(jq 'length' <<<"$matching_pulls")" -ne 1 ]]; then
  write_result false "" "the main commit did not map to exactly one merged pull request"
  exit 0
fi

source_sha="$(jq -r '.[0].head.sha' <<<"$matching_pulls")"
base_sha="$(jq -r '.[0].base.sha' <<<"$matching_pulls")"
source_repo="$(jq -r '.[0].head.repo.full_name // ""' <<<"$matching_pulls")"
if [[ -z "$source_sha" || -z "$base_sha" || "$source_repo" != "$GITHUB_REPOSITORY" ]]; then
  write_result false "" "the reviewed source is not a same-repository pull request"
  exit 0
fi

if ! git cat-file -e "${source_sha}^{commit}" 2>/dev/null || \
  ! git cat-file -e "${base_sha}^{commit}" 2>/dev/null; then
  if ! git fetch --no-tags origin "$source_sha" "$base_sha" >/dev/null 2>&1; then
    write_result false "" "the reviewed commits could not be fetched"
    exit 0
  fi
fi
if [[ "$(git rev-parse "${commit_sha}^{tree}")" != "$(git rev-parse "${source_sha}^{tree}")" ]]; then
  write_result false "" "the merged and reviewed source trees differ"
  exit 0
fi
if ! git diff --quiet "$base_sha" "$source_sha" -- .github scripts; then
  write_result false "" "automation or release-control files changed"
  exit 0
fi

if ! scripts/require-successful-workflow-jobs.sh \
  "CI" "$source_sha" \
  "Workflow lint" "Web" "Android" "Android Connected" >/dev/null; then
  write_result false "" "the reviewed CI gates were incomplete"
  exit 0
fi
if ! scripts/require-successful-workflow-jobs.sh \
  "Security" "$source_sha" \
  "Secret scan" \
  "OpenSSF Scorecard" \
  "CodeQL (javascript-typescript, none)" \
  "CodeQL (java-kotlin, manual)" >/dev/null; then
  write_result false "" "the reviewed security gates were incomplete"
  exit 0
fi

artifacts_available=false
mapfile -t ci_run_ids < <(
  gh run list \
    --workflow CI \
    --commit "$source_sha" \
    --status success \
    --limit 20 \
    --json databaseId \
    --jq '.[].databaseId'
)
for run_id in "${ci_run_ids[@]}"; do
  artifacts="$(gh api "repos/${GITHUB_REPOSITORY}/actions/runs/${run_id}/artifacts?per_page=100")"
  if jq -e --arg sha "$source_sha" '
    [.artifacts[] | select(.expired == false) | .name] as $names |
    ($names | index("cloudflare-worker-" + $sha)) != null and
    ($names | index("android-release-unsigned-" + $sha)) != null and
    ($names | index("android-instrumentation-" + $sha)) != null
  ' <<<"$artifacts" >/dev/null; then
    artifacts_available=true
    break
  fi
done
if [[ "$artifacts_available" != true ]]; then
  write_result false "" "reviewed build artifacts are unavailable or expired"
  exit 0
fi

write_result true "$source_sha" "the reviewed tree, gates, and checksummed artifacts match"
