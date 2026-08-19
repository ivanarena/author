#!/usr/bin/env bash
set -euo pipefail

certificate="$({
  sed -nE \
    's/^(Signer #[0-9]+|V[0-9.]+ Signer):? certificate SHA-256 digest: //p'
} | sed -n '1p' | tr '[:upper:]' '[:lower:]' | tr -d ':')"

if [[ ! "$certificate" =~ ^[0-9a-f]{64}$ ]]; then
  echo 'Could not extract a valid Android signing certificate SHA-256 digest.' >&2
  exit 1
fi

printf '%s\n' "$certificate"
