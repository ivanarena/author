#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT
commit_sha="$(git -C "$repo_root" rev-parse HEAD)"

cat >"$temp_dir/gh" <<'GH'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == api ]]; then
  endpoint="${2:-}"
  if [[ "$endpoint" == */pulls ]]; then
    jq -n --arg sha "$FAKE_SHA" --arg repo "$GITHUB_REPOSITORY" '[{
      merged_at: "2026-01-01T00:00:00Z",
      merge_commit_sha: $sha,
      head: {sha: $sha, repo: {full_name: $repo}},
      base: {sha: $sha}
    }]'
  elif [[ "$endpoint" == */jobs\?per_page=100 ]]; then
    jq -n '{jobs: [
      "Workflow lint", "Web", "Android", "Android Connected",
      "Secret scan", "OpenSSF Scorecard",
      "CodeQL (javascript-typescript, none)",
      "CodeQL (java-kotlin, manual)"
    ] | map({name: ., conclusion: "success"})}'
  elif [[ "$endpoint" == */artifacts\?per_page=100 ]]; then
    jq -n --arg sha "$FAKE_SHA" '{artifacts: [
      {name: ("cloudflare-worker-" + $sha), expired: false},
      {name: ("android-release-unsigned-" + $sha), expired: false},
      {name: ("android-instrumentation-" + $sha), expired: false}
    ]}'
  else
    echo "Unexpected gh api endpoint: $endpoint" >&2
    exit 2
  fi
  exit 0
fi
if [[ "${1:-} ${2:-}" == "run list" ]]; then
  if [[ "$*" == *'.url'* ]]; then
    printf '1\thttps://example.invalid/actions/runs/1\n'
  else
    printf '1\n'
  fi
  exit 0
fi
echo "Unexpected gh invocation: $*" >&2
exit 2
GH
chmod +x "$temp_dir/gh"

export PATH="$temp_dir:$PATH"
export FAKE_SHA="$commit_sha"
export GITHUB_REPOSITORY="example/author"
export GITHUB_EVENT_NAME=push
export GITHUB_REF=refs/heads/main
export GITHUB_OUTPUT="$temp_dir/output"

(
  cd "$repo_root"
  scripts/reuse-reviewed-source.sh "$commit_sha"
)

grep -Fxq 'reusable=true' "$GITHUB_OUTPUT"
grep -Fxq "source_sha=$commit_sha" "$GITHUB_OUTPUT"

echo "Reviewed-source reuse regression passed"
