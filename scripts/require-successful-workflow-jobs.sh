#!/usr/bin/env bash
set -euo pipefail

workflow="${1:-}"
commit_sha="${2:-}"
shift 2 || true

if [[ -z "$workflow" || -z "$commit_sha" || "$#" -eq 0 ]]; then
  echo "Usage: $0 <workflow> <commit-sha> <required-job> [required-job ...]" >&2
  exit 2
fi
if [[ -z "${GITHUB_REPOSITORY:-}" ]]; then
  echo "GITHUB_REPOSITORY is required" >&2
  exit 2
fi

mapfile -t runs < <(
  gh run list \
    --workflow "$workflow" \
    --commit "$commit_sha" \
    --status success \
    --limit 20 \
    --json databaseId,url \
    --jq '.[] | "\(.databaseId)\t\(.url)"'
)

for run in "${runs[@]}"; do
  run_id="${run%%$'\t'*}"
  run_url="${run#*$'\t'}"
  jobs="$(gh api "repos/${GITHUB_REPOSITORY}/actions/runs/${run_id}/jobs?per_page=100")"
  complete=true
  for required_job in "$@"; do
    conclusion="$(
      jq -r --arg name "$required_job" \
        '[.jobs[] | select(.name == $name)] | if length == 1 then .[0].conclusion else "" end' \
        <<<"$jobs"
    )"
    if [[ "$conclusion" != "success" ]]; then
      complete=false
      break
    fi
  done
  if [[ "$complete" == "true" ]]; then
    echo "$workflow gate passed: $run_url"
    exit 0
  fi
done

echo "No successful $workflow run for $commit_sha contained every required successful job: $*" >&2
exit 1
