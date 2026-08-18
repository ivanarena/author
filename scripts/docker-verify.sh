#!/usr/bin/env bash
set -euo pipefail

image_ref="${AUTHOR_DOCKER_IMAGE:-author:verify}"
trivy_image="${TRIVY_IMAGE:-aquasec/trivy@sha256:be1190afcb28352bfddc4ddeb71470835d16462af68d310f9f4bca710961a41e}"
cache_dir="${TRIVY_CACHE_DIR:-.data/trivy-cache}"
image_tar="$(mktemp --suffix=.tar)"
trap 'rm -f "${image_tar}"' EXIT

docker build -t "${image_ref}" .
docker save --output "${image_tar}" "${image_ref}"

mkdir -p "${cache_dir}"

docker run --rm \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -v "${image_tar}:/image.tar:ro" \
  -v "${PWD}/${cache_dir}:/tmp/.cache" \
  "${trivy_image}" image \
  --input /image.tar \
  --scanners vuln \
  --severity CRITICAL,HIGH \
  --pkg-types os,library \
  --exit-code 1 \
  --timeout 10m
