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

release_workflow="$repo_root/.github/workflows/release.yml"
grep -Fq 'workflow_dispatch:' "$release_workflow"
grep -Fq "needs.validate.outputs.phase == 'candidate'" "$release_workflow"
grep -Fq 'dispatch-workflow-and-wait.sh docker.yml' "$release_workflow"
grep -Fq 'dispatch-workflow-and-wait.sh remote-staging.yml' "$release_workflow"
grep -Fq 'dispatch-workflow-and-wait.sh cloudflare.yml' "$release_workflow"
grep -Fq -- '-f channel=candidate' "$release_workflow"
grep -Fq 'Create immutable release tag' "$release_workflow"

ci_workflow="$repo_root/.github/workflows/ci.yml"
cloudflare_workflow="$repo_root/.github/workflows/cloudflare.yml"
android_workflow="$repo_root/.github/workflows/android-release.yml"
grep -Fq 'cloudflare-worker-${{ github.sha }}' "$ci_workflow"
grep -Fq 'Download the exact CI-built Worker bundle' "$cloudflare_workflow"
grep -Fq -- '--no-bundle' "$cloudflare_workflow"
grep -Fq 'author-v${version_name}-candidate-${short_sha}-release-signed.apk' "$android_workflow"
grep -Fq 'Download the accepted production candidate' "$android_workflow"

"$repo_root/scripts/test-dispatch-workflow.sh"

echo "Release workflow gate regressions passed"
