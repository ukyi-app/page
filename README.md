# page

Public HTML rendering service for the homelab app platform.

## API

Admin write:

```bash
curl -X PUT "$BASE_URL/api/pages" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"path":"/demo","html":"<!doctype html><h1>Hello</h1>"}'
```

Render:

```bash
curl "$BASE_URL/demo"
```

Updates require `expectedContentSha256`. Rollback uses `POST /api/pages/rollback` with `path`, positive integer `revisionId`, and `expectedContentSha256`.

## Local Development

```bash
docker compose -f docker-compose.test.yaml up -d
export DATABASE_URL=postgres://page_runtime:runtime@localhost:15432/page_test
export MIGRATE_DATABASE_URL=postgres://page_migrator:migrator@localhost:15432/page_test
export ADMIN_TOKEN=local-admin-token
export ADMIN_TOKEN_SHA256=$(printf '%s' "$ADMIN_TOKEN" | bun run token:hash)
bun install
bun run dev
```

`local-admin-token` is for local development only. Production tokens must be generated from at least 32 random bytes and must never be human-chosen.

## Homelab Onboarding

1. Build and push the first image through the app repo workflow.
2. In homelab, create the `page` database and provision separate migrator/runtime credentials. The migrator credential may own schema and run DDL; the runtime credential must only receive the grants created by startup migration.
3. Put separate `DATABASE_URL`, `MIGRATE_DATABASE_URL`, and `ADMIN_TOKEN_SHA256` values in `.env`. `DATABASE_URL` is the runtime role and must not own schema or have DDL privileges. `MIGRATE_DATABASE_URL` is the migrator role used only at startup to migrate and grant runtime privileges. Generate a production admin token from at least 32 random bytes; never use a human-chosen token and never put the raw token in argv:

```bash
ADMIN_TOKEN="$(openssl rand -base64 32)"
printf 'Store this admin token in the password manager now: %s\n' "$ADMIN_TOKEN"
printf 'ADMIN_TOKEN_SHA256=%s\n' "$(printf '%s' "$ADMIN_TOKEN" | bun run token:hash)" >> .env
unset ADMIN_TOKEN
```

4. Seal `deploy/page-secrets.sealed.yaml`.
5. Run homelab `create-app` for `ukyi-app/page`.
6. Make the GHCR package public before first deploy.
7. Activate DNS/tunnel only after readiness is green.
