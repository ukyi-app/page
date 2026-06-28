# HTML Runner Service Design

**Date:** 2026-06-28
**Status:** Approved by user in hardened-planning Phase A

## Goal

Build a public `html-runner` service on the existing homelab app platform. An administrator can submit a URL path and an HTML document; anyone can open that path and see the stored HTML rendered by the browser.

## Decisions

| Area | Decision |
|---|---|
| Exposure | Public route, expected host `html-runner.${HOMELAB_DOMAIN}` |
| Write access | Administrator only |
| Read access | Public |
| Render policy | Return stored HTML with CSP sandbox that allows scripts but keeps the document in a unique, restricted origin |
| Storage | Postgres |
| Runtime | Bun + TypeScript |
| Homelab integration | Standard external app repo, GHCR arm64 image, `kind: service`, `route.public: true`, app secret via SealedSecret |
| URL mapping | Stored path maps directly to the public route, for example `/demo` renders the page saved at `/demo` |

## Architecture

`html-runner` is a small stateless HTTP service. It runs as a standard homelab `service` app and stores all mutable page data in Postgres. The app repo owns the code, Dockerfile, CI build caller, `.app-config.yml`, and app-level secret sealing inputs. The `homelab` repo owns the generated deployment configuration, database resource, DNS/tunnel activation, and ArgoCD sync.

The service exposes three classes of routes:

- Admin API under `/api/pages`, protected by `Authorization: Bearer <token>`.
- Operational routes: `/healthz`, `/readyz`, and optionally `/metrics`.
- Public render routes: every non-reserved path that exists in Postgres.

Reserved paths cannot be used as page paths. The initial reserved set is `/api`, `/api/*`, `/healthz`, `/readyz`, `/metrics`, `/favicon.ico`, and `/robots.txt`.

## Data Model

The service creates this table during startup with an idempotent migration:

```sql
create table if not exists pages (
  path text primary key,
  html text not null,
  content_sha256 text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

`path` is canonical and always starts with `/`. The accepted format is intentionally narrow: lowercase ASCII letters, digits, `_`, `-`, and `/`, with no `..`, repeated slashes, trailing slash normalization ambiguity, query string, fragment, or percent-decoding behavior. The service stores one canonical path per page.

HTML size is capped by `HTML_MAX_BYTES`, defaulting to `1048576` bytes. The cap applies before database writes.

## Admin API

`PUT /api/pages` accepts JSON:

```json
{
  "path": "/demo",
  "html": "<!doctype html><html><body>Hello</body></html>"
}
```

It validates the path, rejects reserved paths, enforces the HTML byte limit, computes `content_sha256`, and upserts the row. The response returns metadata only:

```json
{
  "path": "/demo",
  "contentSha256": "hex",
  "updatedAt": "2026-06-28T00:00:00.000Z"
}
```

`GET /api/pages/:path` and `DELETE /api/pages/:path` can be added in the implementation plan if they remain admin-only and reuse the same path canonicalization.

Authentication uses a bearer token, but the container should receive only `ADMIN_TOKEN_SHA256`. The server hashes the presented token with SHA-256 and compares it to the configured hash with a constant-time comparison. Missing or invalid auth returns `401`.

## Render Response

`GET /demo` looks up `/demo` in Postgres and returns the stored HTML with these security headers:

```http
Content-Type: text/html; charset=utf-8
Content-Security-Policy: sandbox allow-scripts; frame-ancestors 'none'; base-uri 'none'; object-src 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
```

The sandbox intentionally does not include `allow-same-origin`, `allow-top-navigation`, `allow-popups`, or form permissions. Scripts can run, but the page is isolated from the service origin's cookies/storage and cannot navigate the top-level page.

The service does not rewrite the submitted HTML in the first version. This keeps rendering faithful and avoids sanitizer bypass complexity. The isolation boundary is the HTTP response policy.

## Homelab Integration

The app repo uses the existing homelab external-app model:

1. The app repo builds and pushes `ghcr.io/ukyi-app/html-runner:sha-<commit>` for linux/arm64 through `reusable-app-build.yaml`.
2. Homelab creates a logical Postgres database, expected name `html-runner`, through `create-database`.
3. The runtime `DATABASE_URL` and `MIGRATE_DATABASE_URL`, plus `ADMIN_TOKEN_SHA256`, are placed in the app `.env`, then sealed into `deploy/html-runner-secrets.sealed.yaml`.
4. `.app-config.yml` declares `kind: service`, public route, resource limits, probes, and `secrets: [database-url, migrate-database-url, admin-token-sha256]` or equivalent kebab-case names that map to the required env keys.
5. Homelab `create-app` registers `apps/html-runner/deploy/prod`, adds a memory-ledger row, and creates a public app entry with `active:false`.
6. After first deployment is healthy and GHCR package visibility is public, homelab activation exposes the public DNS/tunnel route.

The app must not require Kubernetes API access. The standard chart setting `automountServiceAccountToken: false` remains valid.

## Failure Modes

- Missing DB or migration failure: readiness fails; liveness can stay healthy only if the process is alive. The service must not claim ready until it can query Postgres.
- Missing or malformed admin token hash: startup fails closed.
- Invalid admin request: return `400` with a machine-readable error code.
- Unauthorized write: return `401`; do not disclose whether a path exists.
- Missing page: return `404`.
- DB unavailable during render: return `503`, not stale or partial content.
- Oversized HTML: return `413`.

## Testing Strategy

Unit tests cover path canonicalization, reserved path rejection, byte-limit enforcement, auth hashing/comparison, and CSP header construction.

Integration tests run the Bun server against a test Postgres instance and verify:

- startup migration is idempotent;
- admin upsert creates and updates a page;
- public `GET /path` returns the exact stored HTML;
- render responses include the sandbox CSP;
- unauthenticated writes fail;
- reserved paths cannot be registered;
- readiness reflects DB connectivity.

Container tests should build the image locally and smoke-test `/healthz` and `/readyz` against a disposable Postgres service before relying on GHCR.

## Alternatives Rejected

PVC file storage was rejected because it makes the app stateful, complicates rollout behavior on the single-node homelab, and does not use the existing Postgres/backup model.

Raw HTML without sandbox headers was rejected for a public service because it would turn user-supplied HTML into same-origin active content.

Script-disabled rendering was rejected because the requested service should be able to run realistic HTML examples that include JavaScript.

Cloudflare Worker/R2 was rejected for the first version because the user explicitly wants to use homelab infrastructure and the existing app platform already covers app build, database, ingress, and GitOps deployment.
