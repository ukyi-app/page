#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
ADMIN_TOKEN="${ADMIN_TOKEN:-local-admin-token}"
SMOKE_PATH="${SMOKE_PATH:-/smoke-$(date +%s)-$$}"

hash="$(curl -fsS -X PUT "$BASE_URL/api/pages" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"path\":\"$SMOKE_PATH\",\"html\":\"<!doctype html><html><body><script>document.body.dataset.ok=\\\"1\\\"</script>smoke</body></html>\"}" \
  | bun -e 'const body=await new Response(Bun.stdin.stream()).json(); console.log(body.contentSha256)')"

curl -fsS "$BASE_URL$SMOKE_PATH" | grep -q "smoke"

curl -fsS -X PUT "$BASE_URL/api/pages" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"path\":\"$SMOKE_PATH\",\"html\":\"updated\",\"expectedContentSha256\":\"$hash\"}" \
  >/dev/null

curl -fsS "$BASE_URL$SMOKE_PATH" | grep -q "updated"

echo "smoke ok"
