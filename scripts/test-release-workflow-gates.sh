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
[[ "$(grep -Fc 'android-release.yml "$RELEASE_SHA" main' "$release_workflow")" -eq 2 ]]
grep -Fq 'Create immutable release tag' "$release_workflow"

ci_workflow="$repo_root/.github/workflows/ci.yml"
cloudflare_workflow="$repo_root/.github/workflows/cloudflare.yml"
android_workflow="$repo_root/.github/workflows/android-release.yml"
staging_workflow="$repo_root/.github/workflows/remote-staging.yml"
auto_candidate_workflow="$repo_root/.github/workflows/auto-candidate.yml"
grep -Fq 'cloudflare-worker-${{ env.ARTIFACT_SHA }}' "$ci_workflow"
grep -Fq 'android-release-unsigned-${{ env.ARTIFACT_SHA }}' "$ci_workflow"
grep -Fq 'Download the exact CI-built Worker bundle' "$cloudflare_workflow"
grep -Fq 'Download the exact CI-built Worker bundle' "$staging_workflow"
grep -Fq -- '--no-bundle' "$cloudflare_workflow"
grep -Fq -- '--no-bundle' "$staging_workflow"
grep -Fq 'Download the exact CI-built unsigned APK' "$android_workflow"
grep -Fq 'Sign the accepted unsigned APK' "$android_workflow"
grep -Fq 'author-v${version_name}-candidate-${short_sha}-release-signed.apk' "$android_workflow"
grep -Fq 'Download the accepted production candidate' "$android_workflow"
if grep -Fq -- '- test' "$android_workflow"; then
  echo "The obsolete Android staging-test channel is still configured" >&2
  exit 1
fi
grep -Fq 'workflow_dispatch:' "$auto_candidate_workflow"
grep -Fq 'release.yml "$RELEASE_SHA" main' "$auto_candidate_workflow"
grep -Fq 'gh workflow run auto-candidate.yml' "$repo_root/.github/workflows/security.yml"

"$repo_root/scripts/test-dispatch-workflow.sh"
"$repo_root/scripts/test-download-workflow-artifact.sh"

reuse_output="$temp_dir/reuse-output"
GITHUB_OUTPUT="$reuse_output" GITHUB_EVENT_NAME=pull_request \
  "$repo_root/scripts/reuse-reviewed-source.sh" candidate-sha
grep -Fxq 'reusable=false' "$reuse_output"
"$repo_root/scripts/test-reuse-reviewed-source.sh"

echo "Release workflow gate regressions passed"
