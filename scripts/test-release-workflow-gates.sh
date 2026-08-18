#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT

cat >"$temp_dir/gh" <<'GH'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-} ${2:-}" == "run list" ]]; then
  printf '123\thttps://example.invalid/actions/runs/123\n'
  exit 0
fi
if [[ "${1:-}" == "api" ]]; then
  printf '{"jobs":[{"name":"Required release job","conclusion":"%s"}]}' \
    "${FAKE_JOB_CONCLUSION:-success}"
  exit 0
fi
echo "Unexpected gh invocation: $*" >&2
exit 2
GH
chmod +x "$temp_dir/gh"

export PATH="$temp_dir:$PATH"
export GITHUB_REPOSITORY="example/author"

FAKE_JOB_CONCLUSION=success \
  "$repo_root/scripts/require-successful-workflow-jobs.sh" \
    "Release workflow" "candidate-sha" "Required release job"

if FAKE_JOB_CONCLUSION=skipped \
  "$repo_root/scripts/require-successful-workflow-jobs.sh" \
    "Release workflow" "candidate-sha" "Required release job"; then
  echo "A skipped required job incorrectly satisfied the release gate" >&2
  exit 1
fi

if FAKE_JOB_CONCLUSION=success \
  "$repo_root/scripts/require-successful-workflow-jobs.sh" \
    "Release workflow" "candidate-sha" "Missing release job"; then
  echo "A missing required job incorrectly satisfied the release gate" >&2
  exit 1
fi

echo "Release workflow gate regressions passed"
