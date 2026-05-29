#!/usr/bin/env bash
set -euo pipefail

image_ref="${AUTHOR_DOCKER_IMAGE:-author:verify}"
trivy_version="${TRIVY_VERSION:-0.70.0}"
cache_dir="${TRIVY_CACHE_DIR:-.data/trivy-cache}"

docker build -t "${image_ref}" .

mkdir -p "${cache_dir}"

docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "${PWD}:/work" \
  -v "${PWD}/${cache_dir}:/root/.cache" \
  "aquasec/trivy:${trivy_version}" image \
  --image-src docker \
  --scanners vuln \
  --severity CRITICAL,HIGH \
  --pkg-types os,library \
  --exit-code 1 \
  --timeout 10m \
  "${image_ref}"
