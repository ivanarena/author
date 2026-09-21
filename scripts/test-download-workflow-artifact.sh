#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT

cat >"$temp_dir/gh" <<'GH'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-} ${2:-}" == "run list" ]]; then
  printf '456\n123\n'
  exit 0
fi
if [[ "${1:-} ${2:-}" == "run download" ]]; then
  run_id="${3:-}"
  shift 3
  destination=""
  while (($#)); do
    if [[ "$1" == --dir ]]; then
      destination="$2"
      break
    fi
    shift
  done
  if [[ "$run_id" == 456 && -n "$destination" ]]; then
    printf 'artifact\n' >"$destination/payload.txt"
    exit 0
  fi
  exit 1
fi
echo "Unexpected gh invocation: $*" >&2
exit 2
GH
chmod +x "$temp_dir/gh"

export PATH="$temp_dir:$PATH"
export GITHUB_REPOSITORY="example/author"
destination="$temp_dir/download"
run_id="$(
  "$repo_root/scripts/download-workflow-artifact.sh" \
    CI candidate-sha artifact-name "$destination"
)"

[[ "$run_id" == 456 ]]
grep -Fxq artifact "$destination/payload.txt"

echo "Workflow artifact download regression passed"
