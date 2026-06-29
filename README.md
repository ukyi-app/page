# page

Public HTML rendering service for the homelab app platform. An administrator stores an HTML
document at a URL path; anyone can open that path and the browser renders the stored HTML under a
strict CSP sandbox.

Runtime: Bun + Hono, with a small NestJS-style framework layer (module / service / controller
classes wired by tsyringe DI). Page data lives in Postgres.

## Architecture

The HTTP layer uses a module / service / controller split. A thin framework layer under
`src/core/di` and `src/core/http` wraps tsyringe and Hono, so application code uses only the
project's own decorators — `@Module`, `@Controller`, `@Service`, `@Injectable`, `@Inject`,
`@Get`/`@Put`/`@Post`, `@UseGuard` — and never imports tsyringe directly.

- **Controller** — parses and validates the request, calls a service, returns a `Response`.
  `@Controller(path)` registers routes and is injectable on its own (no separate `@injectable`).
  `@Controller()` with no argument mounts at the root.
- **Service** — orchestration and business rules (`@Service()`). Reads run under a deadline;
  writes go straight to the repository.
- **Repository** — Postgres access with transactions and optimistic locking on
  `expectedContentSha256`.
- **Module** — `@Module({ imports, controllers, providers })` declares the graph. Providers may be
  classes or `{ provide, useValue | useClass | useFactory }`. `DatabaseModule` provides the Postgres
  `Pool` (`PG_POOL`) via a factory from `ConfigService`, and `PagesModule` binds `PAGES_REPOSITORY`
  to `PageRepository` — so the repository is owned by the DI graph, not constructed by hand.

`buildApp(rootModule, overrides?)` in `src/core/app-factory.ts` is the generic composition factory:
it registers `APP_CONFIG` (from env via `loadConfig`, or an override), registers the module-graph
providers, runs the startup migration (unless skipped), then resolves controllers and mounts them on
a Hono app. `src/main.ts` owns the production entrypoint — `createApp = () => buildApp(AppModule)` —
and calls `Bun.serve`; it never imports the repository or pools itself. Tests call `buildApp`
directly with provider overrides (a fake repository) and `skipMigration`. Route registration order
(guards → exact routes → 405 catch-alls → render wildcard → global fallback) is enforced by
`RouterFactory`, so the 404 / 405 / 401 behavior is deterministic regardless of declaration order.

### Project structure

```
src/
  main.ts                  # entrypoint: createApp = buildApp(AppModule) + Bun.serve
  app.module.ts            # AppModule (@Module): imports DatabaseModule + feature modules
  core/
    app-factory.ts         # buildApp: provider registration, startup migration, controller mount
    di/
      decorators.ts        # @Injectable / @Service / @Inject  (the only tsyringe boundary)
      module.ts            # @Module + Provider forms + collectControllers / collectProviders
    http/
      decorators.ts        # @Controller / @Get / @Put / @Post / @UseGuard
      router.factory.ts    # decorator routing -> Hono (registration-order invariant)
      exception.filter.ts  # error -> Response mapping (Hono onError)
      responses.ts         # native Response helpers (json / error)
      bounded-json.ts      # size-bounded JSON body reader
      http-errors.ts       # BadRequestError / RequestTooLargeError
    config/                # config.ts (loadConfig) + config.service.ts + config.tokens.ts (APP_CONFIG)
    database/              # db.ts (createPool/migrate) + database.module.ts + database.tokens.ts (PG_POOL)
    auth/                  # auth-token.ts (constant-time bearer) + auth.guard.ts
    path/page-path.ts      # path canonicalization + reserved paths
    render/render-headers.ts  # CSP sandbox headers
  modules/
    pages/                 # pages.module, admin + render controllers, service,
                           # repository, contract, validation
    health/                # health.module + health.controller
```

## API

All `/api/pages` routes require `Authorization: Bearer <token>`. Render routes are public.

| Method & path | Purpose |
|---|---|
| `GET /health` | liveness — `{ "ok": true }` |
| `PUT /api/pages` | create or update a page (update requires `expectedContentSha256`) |
| `GET /api/pages?path=/demo` | current page metadata |
| `GET /api/pages/revisions?path=/demo` | bounded revision list |
| `POST /api/pages/rollback` | move current pointer to an earlier revision |
| `GET /<path>` | render the stored HTML for that path |

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

Updates require `expectedContentSha256`. Rollback uses `POST /api/pages/rollback` with `path`,
positive integer `revisionId`, and `expectedContentSha256`.

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

`local-admin-token` is for local development only. Production tokens must be generated from at
least 32 random bytes and must never be human-chosen.

## Testing

```bash
docker compose -f docker-compose.test.yaml up -d
bun run typecheck
bun run test:unit
ALLOW_TEST_DB_RESET=1 bun run test:integration
```

Unit tests cover the framework (DI, decorator routing, exception filter) and the request contract
with in-memory fakes. Integration tests run against the disposable `page_test` database;
`ALLOW_TEST_DB_RESET=1` is required because the integration suite drops and recreates the schema.

## Build & Release

Pushing to `main` triggers `.github/workflows/release.yaml`, which calls the homelab reusable
build workflow to build a `linux/arm64` image and push it to GHCR as
`ghcr.io/ukyi-app/page:sha-<commit>`. Deployment is driven separately by the homelab side; this
repo only builds and pushes the image.

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

4. Run `bun run secret:seal` to create `deploy/page-secrets.sealed.yaml`. The sealed file's `spec.encryptedData` keys are the secret key list; `.app-config.yml` does not declare individual secrets.
5. Run homelab `create-app` for `ukyi-app/page` with the sealed file.
6. Confirm private GHCR pull works through the shared `ghcr-pull` imagePullSecret.
7. Activate DNS/tunnel only after `/health` is green.
