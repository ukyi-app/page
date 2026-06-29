#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${CONTAINER_NAME:-page-container-smoke}"
IMAGE="${IMAGE:-page:local}"
DATABASE_URL="${DATABASE_URL:-postgres://page_runtime:runtime@host.docker.internal:15432/page_test}"
MIGRATE_DATABASE_URL="${MIGRATE_DATABASE_URL:-postgres://page_migrator:migrator@host.docker.internal:15432/page_test}"
ADMIN_TOKEN="${ADMIN_TOKEN:-local-admin-token}"
ADMIN_TOKEN_SHA256="${ADMIN_TOKEN_SHA256:-$(printf '%s' "$ADMIN_TOKEN" | bun scripts/hash-token.ts)}"

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    docker logs "$CONTAINER_NAME" || true
  fi
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER_NAME" \
  --add-host=host.docker.internal:host-gateway \
  -e DATABASE_URL="$DATABASE_URL" \
  -e MIGRATE_DATABASE_URL="$MIGRATE_DATABASE_URL" \
  -e ADMIN_TOKEN_SHA256="$ADMIN_TOKEN_SHA256" \
  -p 18080:8080 \
  "$IMAGE" >/dev/null

for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:18080/health >/dev/null 2>&1; then break; fi
  sleep 1
done

curl -fsS http://127.0.0.1:18080/health >/dev/null
BASE_URL=http://127.0.0.1:18080 ADMIN_TOKEN="$ADMIN_TOKEN" bun run smoke
