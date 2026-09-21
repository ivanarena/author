#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT

cat >"$temp_dir/gh" <<'GH'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-} ${2:-}" in
  "run list")
    if [[ -e "$FAKE_GH_STATE" ]]; then
      printf '[{"databaseId":456,"headSha":"candidate-sha","status":"completed","conclusion":"success","url":"https://example.invalid/actions/runs/456"}]\n'
    else
      printf '[]\n'
    fi
    ;;
  "workflow run")
    touch "$FAKE_GH_STATE"
    printf 'https://example.invalid/actions/runs/456\n'
    ;;
  "run view")
    printf '{"status":"completed","conclusion":"success","headSha":"candidate-sha","url":"https://example.invalid/actions/runs/456","jobs":[{"name":"Required job","conclusion":"success"}]}\n'
    ;;
  *)
    echo "Unexpected gh invocation: $*" >&2
    exit 2
    ;;
esac
GH
chmod +x "$temp_dir/gh"

export PATH="$temp_dir:$PATH"
export FAKE_GH_STATE="$temp_dir/dispatched"
export GITHUB_REPOSITORY="example/author"
export GITHUB_OUTPUT="$temp_dir/output"
export GITHUB_STEP_SUMMARY="$temp_dir/summary"

"$repo_root/scripts/dispatch-workflow-and-wait.sh" \
  android-release.yml candidate-sha main \
  -f channel=candidate

grep -Fxq 'run_id=456' "$GITHUB_OUTPUT"
grep -Fxq 'run_url=https://example.invalid/actions/runs/456' "$GITHUB_OUTPUT"
grep -Fq '[android-release.yml](https://example.invalid/actions/runs/456)' \
  "$GITHUB_STEP_SUMMARY"

echo "Workflow dispatch-and-wait regression passed"
