#!/usr/bin/env bash
set -euo pipefail

workflow="${1:-}"
expected_sha="${2:-}"
workflow_ref="${3:-main}"
if [[ -z "$workflow" || -z "$expected_sha" ]]; then
  echo "Usage: $0 <workflow> <expected-sha> [workflow-ref] [workflow inputs...]" >&2
  exit 2
fi
if (($# >= 3)); then
  shift 3
else
  shift 2
fi

repo="${GITHUB_REPOSITORY:-}"
if [[ -z "$repo" ]]; then
  echo "GITHUB_REPOSITORY is required" >&2
  exit 2
fi

command -v gh >/dev/null
command -v jq >/dev/null

temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT
before_ids="$temp_dir/before-ids"
: >"$before_ids"

list_runs() {
  gh run list \
    --repo "$repo" \
    --workflow "$workflow" \
    --event workflow_dispatch \
    --limit 30 \
    --json databaseId,headSha,status,conclusion,url
}

listed_existing_runs=false
for attempt in 1 2 3; do
  if runs="$(list_runs 2>/dev/null)"; then
    jq -r '.[].databaseId' <<<"$runs" >"$before_ids"
    listed_existing_runs=true
    break
  fi
  sleep $((attempt * 5))
done

if [[ "$listed_existing_runs" != true ]]; then
  echo "Unable to list existing $workflow runs before dispatch" >&2
  exit 1
fi

gh workflow run "$workflow" --repo "$repo" --ref "$workflow_ref" "$@"

run_id=""
run_url=""
discovery_deadline=$((SECONDS + 180))
while ((SECONDS < discovery_deadline)); do
  if runs="$(list_runs 2>/dev/null)"; then
    while IFS=$'\t' read -r candidate_id candidate_sha candidate_url; do
      [[ "$candidate_sha" == "$expected_sha" ]] || continue
      grep -qx "$candidate_id" "$before_ids" && continue
      run_id="$candidate_id"
      run_url="$candidate_url"
      break
    done < <(jq -r '.[] | [.databaseId, .headSha, .url] | @tsv' <<<"$runs")
  fi
  [[ -n "$run_id" ]] && break
  sleep 5
done

if [[ -z "$run_id" ]]; then
  echo "Timed out locating the new $workflow run for $expected_sha" >&2
  exit 1
fi

printf '%s run: %s\n' "$workflow" "$run_url"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "run_id=$run_id"
    echo "run_url=$run_url"
  } >>"$GITHUB_OUTPUT"
fi
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  printf -- '- [%s](%s)\n' "$workflow" "$run_url" >>"$GITHUB_STEP_SUMMARY"
fi

wait_timeout_seconds="${WORKFLOW_WAIT_TIMEOUT_SECONDS:-3600}"
wait_deadline=$((SECONDS + wait_timeout_seconds))
while ((SECONDS < wait_deadline)); do
  if run="$(
    gh run view "$run_id" \
      --repo "$repo" \
      --json status,conclusion,headSha,url,jobs \
      2>/dev/null
  )"; then
    actual_sha="$(jq -r '.headSha' <<<"$run")"
    if [[ "$actual_sha" != "$expected_sha" ]]; then
      echo "Workflow run $run_id used $actual_sha, expected $expected_sha" >&2
      exit 1
    fi

    if [[ "$(jq -r '.status' <<<"$run")" == completed ]]; then
      jq '{status, conclusion, headSha, url, jobs: [.jobs[] | {name, conclusion}]}' <<<"$run"
      if [[ "$(jq -r '.conclusion' <<<"$run")" == success ]]; then
        exit 0
      fi
      gh run view "$run_id" --repo "$repo" --log-failed >&2 || true
      exit 1
    fi
  fi
  sleep 10
done

echo "Timed out waiting for $run_url" >&2
exit 1
