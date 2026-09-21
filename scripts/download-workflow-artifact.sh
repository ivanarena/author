#!/usr/bin/env bash
set -euo pipefail

workflow="${1:-}"
commit_sha="${2:-}"
artifact_name="${3:-}"
destination="${4:-}"

if [[ -z "$workflow" || -z "$commit_sha" || -z "$artifact_name" || -z "$destination" ]]; then
  echo "Usage: $0 <workflow> <commit-sha> <artifact-name> <destination>" >&2
  exit 2
fi
if [[ -z "${GITHUB_REPOSITORY:-}" ]]; then
  echo "GITHUB_REPOSITORY is required" >&2
  exit 2
fi
case "$destination" in
  / | . | ..)
    echo "Refusing unsafe artifact destination: $destination" >&2
    exit 2
    ;;
esac

command -v gh >/dev/null

rm -rf "$destination"
mkdir -p "$destination"

mapfile -t run_ids < <(
  gh run list \
    --repo "$GITHUB_REPOSITORY" \
    --workflow "$workflow" \
    --commit "$commit_sha" \
    --status success \
    --limit 20 \
    --json databaseId \
    --jq '.[].databaseId'
)

for run_id in "${run_ids[@]}"; do
  rm -rf "${destination:?}"/*
  if gh run download "$run_id" \
    --repo "$GITHUB_REPOSITORY" \
    --name "$artifact_name" \
    --dir "$destination" >&2; then
    printf '%s\n' "$run_id"
    exit 0
  fi
done

echo "No successful $workflow run for $commit_sha contained artifact $artifact_name" >&2
exit 1
