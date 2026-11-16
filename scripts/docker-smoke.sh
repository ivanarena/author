#!/usr/bin/env bash
# Starts the built image and checks that the API can use its database, so a
# broken runtime dependency closure fails the build instead of a deployment.
set -euo pipefail

image_ref="${1:?Usage: $0 <image-ref>}"
port="${AUTHOR_SMOKE_PORT:-38080}"
container="author-smoke-$$"
base_url="http://127.0.0.1:${port}"

cleanup() {
  docker rm -f -v "${container}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run -d --name "${container}" \
  --read-only \
  --tmpfs /tmp \
  -p "127.0.0.1:${port}:3000" \
  -e NOTES_DB_PATH=/tmp/author-smoke.sqlite \
  -e NOTES_SERVER_SECRET=docker-smoke-server-secret-0123456789abcdef \
  -e NOTES_LOGIN_PASSWORD=docker-smoke-login-password \
  -e NOTES_BACKUP_ENABLED=false \
  -e NOTES_CLEANUP_ENABLED=false \
  "${image_ref}" >/dev/null

fail() {
  echo "Docker smoke test failed: $1" >&2
  docker logs "${container}" >&2 || true
  exit 1
}

healthy=false
for _ in $(seq 1 60); do
  if curl -fsS "${base_url}/api/health" >/dev/null 2>&1; then
    healthy=true
    break
  fi
  sleep 1
done
[[ "${healthy}" == true ]] || fail "health endpoint did not respond"

# The login challenge reads the users table, so it needs a working database
# driver and applied migrations.
response="$(
  curl -sS -w '\n%{http_code}' -X POST "${base_url}/api/auth/challenge" \
    -H 'content-type: application/json' \
    -d '{"username":"owner","purpose":"login","clientNonce":"c21va2UtdGVzdC1ub25jZS0wMQ"}'
)" || fail "auth challenge request failed"
status="${response##*$'\n'}"
body="${response%$'\n'*}"
[[ "${status}" == 200 ]] || fail "auth challenge returned ${status}: ${body}"
grep -q '"mode":"bootstrap"' <<<"${body}" ||
  fail "auth challenge returned an unexpected body: ${body}"

if docker logs "${container}" 2>&1 | grep -Eq 'ERR_MODULE_NOT_FOUND|Cannot find package'; then
  fail "runtime reported a missing module"
fi

echo "Docker smoke test passed for ${image_ref}."
