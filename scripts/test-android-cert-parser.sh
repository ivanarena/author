#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
extractor="$repo_root/scripts/extract-android-cert-sha256.sh"
expected='0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

legacy="$(printf '%s\n' \
  'Signer #1 certificate DN: CN=Author' \
  'Signer #1 certificate SHA-256 digest: 0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF' \
  | "$extractor")"
[[ "$legacy" == "$expected" ]]

current="$(printf '%s\n' \
  'V2 Signer: certificate DN: CN=Author' \
  'V2 Signer: certificate SHA-256 digest: 01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF' \
  | "$extractor")"
[[ "$current" == "$expected" ]]

if printf '%s\n' 'Verified using v2 scheme: true' | "$extractor" >/dev/null 2>&1; then
  echo 'Malformed apksigner output was unexpectedly accepted.' >&2
  exit 1
fi

echo 'Android certificate parser regressions passed'
