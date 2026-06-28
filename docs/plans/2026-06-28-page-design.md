# Page Service Design

**Date:** 2026-06-28
**Status:** Approved by user in hardened-planning Phase A

## Goal

Build a public `page` service on the existing homelab app platform. An administrator can submit a URL path and an HTML document; anyone can open that path and see the stored HTML rendered by the browser.

## Decisions

| Area | Decision |
|---|---|
| Exposure | Public route, expected host `page.${HOMELAB_DOMAIN}` |
| Write access | Administrator only |
| Read access | Public |
| Render policy | Return stored HTML with CSP sandbox that allows inline scripts but blocks external network/resource loading by default |
| Storage | Postgres |
| Runtime | Bun + TypeScript |
| Homelab integration | Standard external app repo, GHCR arm64 image, `kind: service`, `route.public: true`, app secret via SealedSecret |
| URL mapping | Stored path maps directly to the public route, for example `/demo` renders the page saved at `/demo` |

## Architecture

`page` is a small stateless HTTP service. It runs as a standard homelab `service` app and stores all mutable page data in Postgres. The app repo owns the code, Dockerfile, CI build caller, `.app-config.yml`, and app-level secret sealing inputs. The `homelab` repo owns the generated deployment configuration, database resource, DNS/tunnel activation, and ArgoCD sync.

The service exposes three classes of routes:

- Admin API under `/api/pages`, protected by `Authorization: Bearer <token>`.
- Operational routes: `/healthz`, `/readyz`, and optionally `/metrics`.
- Public render routes: every non-reserved path that exists in Postgres.

Reserved paths cannot be used as page paths. The initial reserved set is `/api`, `/api/*`, `/healthz`, `/readyz`, `/metrics`, `/favicon.ico`, and `/robots.txt`.

## Trust Model

Only the administrator can create or update pages, but every saved page is public. The service therefore treats saved HTML as admin-authored content with visitor-protection boundaries, not as fully trusted same-origin application code.

Version 1 does not support loading external scripts, images, fonts, frames, beacons, or API calls from rendered pages. HTML can include inline markup, inline CSS, and inline JavaScript. If external resources become necessary later, they must be added through an explicit allowlist design, preferably with a separate sandbox host or per-page policy rather than a global escape hatch.

## Data Model

The service creates these tables during startup with an idempotent migration:

```sql
create table if not exists pages (
  path text primary key,
  current_revision_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists page_revisions (
  id bigserial primary key,
  path text not null references pages(path) on delete cascade,
  html text not null,
  content_sha256 text not null,
  created_at timestamptz not null default now(),
  unique (path, content_sha256)
);

alter table pages
  add constraint pages_current_revision_fk
  foreign key (current_revision_id) references page_revisions(id);
```

`path` is canonical and always starts with `/`. The accepted format is intentionally narrow: lowercase ASCII letters, digits, `_`, `-`, and `/`, with no `..`, repeated slashes, trailing slash normalization ambiguity, query string, fragment, or percent-decoding behavior. The service stores one canonical path per page.

HTML size is capped by `HTML_MAX_BYTES`, defaulting to `1048576` bytes. The cap applies before database writes.

Updates are revisioned. A public render reads `pages.current_revision_id`, then returns that revision's HTML. New writes create a revision first, then move the current pointer in the same transaction. Old revisions remain available for rollback.

## Admin API

`PUT /api/pages` accepts JSON:

```json
{
  "path": "/demo",
  "html": "<!doctype html><html><body>Hello</body></html>",
  "expectedContentSha256": "optional-current-hash"
}
```

It validates the path, rejects reserved paths, enforces the HTML byte limit, computes `content_sha256`, creates a new revision, and points the page at that revision. For an existing page, `expectedContentSha256` is required and must match the current revision; otherwise the service returns `409`. Creating a new path omits `expectedContentSha256`.

The response returns metadata only:

```json
{
  "path": "/demo",
  "revisionId": 12,
  "contentSha256": "hex",
  "updatedAt": "2026-06-28T00:00:00.000Z"
}
```

Admin-only read operations should include `GET /api/pages?path=/demo` for current metadata and `GET /api/pages/revisions?path=/demo` for a bounded revision list.

Rollback is an admin-only operation: `POST /api/pages/rollback` with `{ "path": "/demo", "revisionId": 11, "expectedContentSha256": "current-hash" }`. It verifies the target revision belongs to that path, checks the current hash, then moves `pages.current_revision_id` back to the target revision. Rollback creates no new HTML body, but it does update `pages.updated_at`.

`DELETE /api/pages` can be added in the implementation plan if it remains admin-only, uses the same path canonicalization, and either tombstones the page or deletes it with explicit confirmation. Deletion is not required for version 1.

Authentication uses a bearer token, but the container should receive only `ADMIN_TOKEN_SHA256`. The server hashes the presented token with SHA-256 and compares it to the configured hash with a constant-time comparison. Missing or invalid auth returns `401`.

## Render Response

`GET /demo` looks up `/demo` in Postgres and returns the stored HTML with these security headers:

```http
Content-Type: text/html; charset=utf-8
Content-Security-Policy: sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; prefetch-src 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
```

The sandbox intentionally does not include `allow-same-origin`, `allow-top-navigation`, `allow-popups`, or form permissions. Inline scripts can run, but the page is isolated from the service origin's cookies/storage, cannot navigate the top-level page, and cannot make external network requests or load external resources under the version 1 policy.

The service does not rewrite the submitted HTML in the first version. This keeps rendering faithful and avoids sanitizer bypass complexity. The isolation boundary is the HTTP response policy.

## Homelab Integration

The app repo uses the existing homelab external-app model:

1. The app repo builds and pushes `ghcr.io/ukyi-app/page:sha-<commit>` for linux/arm64 through `reusable-app-build.yaml`.
2. Homelab creates a logical Postgres database, expected name `page`, through `create-database`.
3. The runtime `DATABASE_URL` and `MIGRATE_DATABASE_URL`, plus `ADMIN_TOKEN_SHA256`, are placed in the app `.env`, then sealed into `deploy/page-secrets.sealed.yaml`.
4. `.app-config.yml` declares `kind: service`, public route, resource limits, probes, and `secrets: [database-url, migrate-database-url, admin-token-sha256]` or equivalent kebab-case names that map to the required env keys.
5. Homelab `create-app` registers `apps/page/deploy/prod`, adds a memory-ledger row, and creates a public app entry with `active:false`.
6. After first deployment is healthy and GHCR package visibility is public, homelab activation exposes the public DNS/tunnel route.

The app must not require Kubernetes API access. The standard chart setting `automountServiceAccountToken: false` remains valid.

## Failure Modes

- Missing DB or migration failure: readiness fails; liveness can stay healthy only if the process is alive. The service must not claim ready until it can query Postgres.
- Missing or malformed admin token hash: startup fails closed.
- Invalid admin request: return `400` with a machine-readable error code.
- Unauthorized write: return `401`; do not disclose whether a path exists.
- Write conflict because `expectedContentSha256` is stale or missing for an existing page: return `409` with current metadata but not the HTML body.
- Missing page: return `404`.
- DB unavailable during render: return `503`, not stale or partial content.
- Oversized HTML: return `413`.
- Bad rollback target: return `404` if the target revision does not belong to the path, or `409` if the current hash changed.

## Testing Strategy

Unit tests cover path canonicalization, reserved path rejection, byte-limit enforcement, auth hashing/comparison, and CSP header construction.

Integration tests run the Bun server against a test Postgres instance and verify:

- startup migration is idempotent;
- admin create writes the first revision;
- admin update requires the current `expectedContentSha256` and creates a new revision;
- stale updates fail with `409`;
- admin rollback restores a previous revision with an optimistic concurrency check;
- public `GET /path` returns the exact stored HTML;
- render responses include the network-closed sandbox CSP;
- unauthenticated writes fail;
- reserved paths cannot be registered;
- readiness reflects DB connectivity.

Container tests should build the image locally and smoke-test `/healthz` and `/readyz` against a disposable Postgres service before relying on GHCR.

## Alternatives Rejected

PVC file storage was rejected because it makes the app stateful, complicates rollout behavior on the single-node homelab, and does not use the existing Postgres/backup model.

Raw HTML without sandbox headers was rejected for a public service because it would turn saved HTML into same-origin active content.

Script-disabled rendering was rejected because the requested service should be able to run realistic HTML examples that include JavaScript.

External resource loading in rendered pages was rejected for version 1 because it would allow saved pages to beacon, track visitors, or drive browser-originated requests to third-party endpoints. If needed later, it should be designed as an explicit allowlist.

Upsert-only storage was rejected because a mistaken admin write could irreversibly replace public content without a safe rollback path.

Cloudflare Worker/R2 was rejected for the first version because the user explicitly wants to use homelab infrastructure and the existing app platform already covers app build, database, ingress, and GitOps deployment.
