# page

홈랩 앱 플랫폼을 위한 공개 HTML/Markdown 렌더링 서비스. 관리자가 URL 경로에 HTML 문서 — 또는
Markdown 원본 — 를 저장하면, 누구나 그 경로를 열어 엄격한 CSP sandbox 아래에서 렌더된 결과를 본다.
HTML은 그대로 서빙된다. Markdown은 저장 시점에 스타일이 인라인된 완결형 HTML 문서로 한 번 렌더해
두고, 공개 요청 시점에는 HTML과 동일하게 정적으로 서빙한다(요청마다 파싱하지 않는다). 원본 소스는
편집을 위해 그대로 보존된다. 콘텐츠 타입은 리비전 단위로 보존되므로, 롤백하면 콘텐츠와 타입이 함께
복원된다.

런타임: Bun + Hono, 그리고 tsyringe DI로 엮인 작은 NestJS 스타일 프레임워크 계층(module / service /
controller 클래스). 페이지 데이터는 Postgres에 저장된다.

## 아키텍처

HTTP 계층은 module / service / controller로 나뉜다. `src/core/di`·`src/core/http` 아래의 얇은
프레임워크 계층이 tsyringe와 Hono를 감싸므로, 애플리케이션 코드는 프로젝트 자체 데코레이터 —
`@Module`, `@Controller`, `@Service`, `@Injectable`, `@Inject`, `@Get`/`@Put`/`@Post`, `@UseGuard` —
만 사용하며 tsyringe를 직접 import하지 않는다.

- **Controller** — 요청을 파싱·검증하고, 서비스를 호출해 `Response`를 반환한다.
  `@Controller(path)`는 라우트를 등록하며 그 자체로 주입 가능하다(별도의 `@injectable` 불필요).
  인자 없는 `@Controller()`는 루트에 마운트된다.
- **Service** — 오케스트레이션과 비즈니스 규칙(`@Service()`). 읽기는 데드라인 아래에서 실행되고,
  쓰기는 리포지토리로 곧장 전달된다.
- **Repository** — 트랜잭션과 `expectedContentSha256` 기반 낙관적 잠금을 사용하는 Postgres 접근.
- **Module** — `@Module({ imports, controllers, providers })`로 그래프를 선언한다. provider는 클래스
  이거나 `{ provide, useValue | useClass | useFactory }` 형태일 수 있다. `DatabaseModule`은
  `ConfigService` 기반 팩토리로 Postgres `Pool`(`PG_POOL`)을 제공하고, `PagesModule`은
  `PAGES_REPOSITORY`를 `PageRepository`에 바인딩한다 — 즉 리포지토리는 손으로 만드는 게 아니라
  DI 그래프가 소유한다.

`src/core/app-factory.ts`의 `buildApp(rootModule, overrides?)`는 범용 조립 팩토리다: `APP_CONFIG`
(env에서 `loadConfig`로, 또는 override로)를 등록하고, 모듈 그래프의 provider들을 등록하고, 시작 시
마이그레이션을 실행하며(건너뛰지 않는 한), 컨트롤러를 resolve해 Hono 앱에 마운트한다. `src/main.ts`가
프로덕션 진입점을 소유한다 — `createApp = () => buildApp(AppModule)` — 그리고 `Bun.serve`를 호출한다.
이 진입점은 리포지토리나 풀을 직접 import하지 않는다. 테스트는 provider override(가짜 리포지토리)와
`skipMigration`을 넘겨 `buildApp`을 직접 호출한다. 라우트 등록 순서(가드 → 정확 경로 → 405 catch-all
→ 렌더 와일드카드 → 전역 fallback)는 `RouterFactory`가 강제하므로, 선언 순서와 무관하게 404 / 405 /
401 동작이 결정적이다.

### 프로젝트 구조

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
    render/                # render-headers.ts (CSP sandbox headers) + markdown.ts (Markdown -> HTML doc)
  modules/
    pages/                 # pages.module, admin + render controllers, service,
                           # repository, contract, validation
    admin/                 # admin.module + admin-ui.controller (serves the /admin SPA)
    health/                # health.module + health.controller
web/                       # admin console SPA (Vite + React + Tailwind v4 + Base UI),
                           # built single-file → web/dist/index.html, served at /admin
```

## API

모든 `/api/pages` 라우트는 `Authorization: Bearer <token>`을 요구한다. 렌더 라우트는 공개다.

| Method & path | 용도 |
|---|---|
| `GET /health` | liveness — `{ "ok": true }` |
| `PUT /api/pages` | 페이지 생성 또는 수정(수정은 `expectedContentSha256` 필요). 저장하면 비활성 페이지가 다시 공개된다. 선택적 `contentType`(기본 `"html"`, 또는 `"markdown"`); 어느 쪽이든 원본은 `html` 필드에 담는다 |
| `GET /api/pages?path=/demo` | 현재 페이지 메타데이터(비활성이면 404) |
| `GET /api/pages/list` | 비활성 포함 전체 현재 페이지 목록(`disabledAt` / `purgeAfter` 포함) |
| `GET /api/pages/source?path=/demo` | 원본 `html`을 포함한 현재 페이지(관리 편집용; 비활성 페이지도 동작) |
| `GET /api/pages/revisions?path=/demo` | 한도가 있는 리비전 목록 |
| `DELETE /api/pages?path=/demo` | soft delete(즉시 비활성화, 약 1주 뒤 purge 예약) |
| `POST /api/pages/rollback` | 현재 포인터를 이전 리비전으로 이동 |
| `POST /api/pages/restore` | soft delete된 페이지를 재활성화하고 purge 예약 취소 |
| `GET /<path>` | 해당 경로의 페이지 렌더 — 저장된 HTML은 그대로, Markdown은 스타일 HTML 문서로 변환(비활성이면 404) |
| `GET /admin` | 관리 콘솔 SPA(공개 셸; 모든 동작은 토큰 필요) |

soft delete는 되돌릴 수 있다: `DELETE`는 `disabled_at` / `purge_after`를 설정하고(행은 보존), 렌더
라우트는 즉시 404를 반환하며, 백그라운드 스윕이 `purge_after`가 지난 페이지를 완전 삭제한다
(`PURGE_GRACE_MS`, 기본 7일; 스윕 주기 `PURGE_SWEEP_INTERVAL_MS`, 기본 1시간). 복원(또는 페이지를
다시 저장)하면 purge가 취소된다.

관리 쓰기:

```bash
curl -X PUT "$BASE_URL/api/pages" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"path":"/demo","html":"<!doctype html><h1>Hello</h1>"}'
```

Markdown으로 저장하려면 `contentType`을 함께 보내고, `html` 필드에 Markdown 원본을 담는다:

```bash
curl -X PUT "$BASE_URL/api/pages" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"path":"/post","contentType":"markdown","html":"# Hello\n\n본문"}'
```

렌더:

```bash
curl "$BASE_URL/demo"
```

수정은 `expectedContentSha256`을 요구한다. 롤백은 `POST /api/pages/rollback`에 `path`, 양의 정수
`revisionId`, `expectedContentSha256`을 넘긴다.

## 관리 콘솔 (`/admin`)

단일 페이지 관리 UI(Vite + React + Tailwind v4 + Base UI, shadcn 스타일 컴포넌트)가 `web/`에 있다.
이는 자체 완결형 `web/dist/index.html` 한 파일(JS·CSS·폰트 인라인)로 빌드되어 백엔드가 same-origin CSP
아래 `GET /admin`에서 서빙한다 — 그래서 CORS가 필요 없고 같은 이미지 안에 함께 실린다. 페이지 자체는
공개 셸이며, 모든 동작은 `Authorization: Bearer <token>`을 보내므로 관리 토큰 없이는 아무것도 되지 않는다.

기능: id(`ukkiee`) + 관리 토큰으로 로그인, 전체 페이지 목록(활성·비활성) 조회, 페이지 생성/편집(경로
검증; HTML 또는 Markdown 파일을 붙여넣거나 업로드 — 형식은 확장자로 추론되고 HTML/Markdown 토글로
전환 가능하며, 라이브 미리보기는 실제 공개 렌더와 일치한다), 렌더된 페이지 열기, soft delete(purge
카운트다운 포함)와 복원. Markdown 페이지는 목록에서 `md` 배지로 표시된다. 토큰은 `sessionStorage`에
보관되며 로그아웃 시 지워진다.

SPA 로컬 개발(`/api`를 백엔드로 프록시하므로 CORS 불필요):

```bash
bun run dev            # backend on :8080 (see below)
bun run web:dev        # admin SPA on http://localhost:5173 (proxies /api → :8080)
# point the proxy elsewhere (e.g. prod): VITE_API_PROXY=https://page.ukyi.app bun run web:dev
```

백엔드가 `/admin`에서 서빙하는 단일 파일 번들 빌드:

```bash
bun run web:build      # → web/dist/index.html (the Docker image builds this in its own stage)
```

## 로컬 개발

`loadConfig`는 홈랩 conn 핸들 이름(`PAGE_DATABASE_URL`, `PAGE_MIGRATE_DATABASE_URL`)을 먼저 읽고,
프리픽스 없는 `DATABASE_URL` / `MIGRATE_DATABASE_URL`로 폴백한다. 로컬에서는 프리픽스 키를
`.env.local`에 둔다(Bun이 자동 로드하며, gitignore됨):

```bash
docker compose -f docker-compose.test.yaml up -d
ADMIN_TOKEN=local-admin-token
cat > .env.local <<EOF
PAGE_DATABASE_URL=postgres://page_runtime:runtime@localhost:15432/page_test
PAGE_MIGRATE_DATABASE_URL=postgres://page_migrator:migrator@localhost:15432/page_test
ADMIN_TOKEN_SHA256=$(printf '%s' "$ADMIN_TOKEN" | bun run token:hash)
EOF
bun install
bun run dev
```

`local-admin-token`은 로컬 개발 전용이다. 프로덕션 토큰은 최소 32바이트 난수로 생성해야 하며 사람이
고른 값이어서는 안 된다. 프로덕션에서 이 값들은 `.env`에 없다 — `PAGE_*`는 `db-page-conn`
SealedSecret에서, `ADMIN_TOKEN_SHA256`은 앱의 sealed secret에서 온다.

## 테스트

```bash
docker compose -f docker-compose.test.yaml up -d
bun run typecheck
bun run test:unit
ALLOW_TEST_DB_RESET=1 bun run test:integration
```

단위 테스트는 프레임워크(DI, 데코레이터 라우팅, exception filter)와 in-memory 가짜를 쓴 요청 계약을
다룬다. 통합 테스트는 일회용 `page_test` 데이터베이스를 대상으로 실행되며, 통합 스위트가 스키마를
drop·재생성하므로 `ALLOW_TEST_DB_RESET=1`이 필요하다.

## 빌드 & 릴리스

`main`에 푸시하면 `.github/workflows/release.yaml`가 트리거되어, 홈랩 재사용 빌드 워크플로를 호출해
`linux/arm64` 이미지를 빌드하고 GHCR에 `ghcr.io/ukyi-app/page:sha-<commit>`로 푸시한다. 배포는 홈랩
쪽에서 별도로 구동되며, 이 저장소는 이미지를 빌드·푸시만 한다.

`Dockerfile`은 멀티 스테이지다: `web` 스테이지가 `web/` 안에서 `bun run build`를 실행해 단일 파일
`web/dist/index.html`을 만들고, 런타임 스테이지가 이를 `/app/web/dist`로 복사해 백엔드가 `/admin`에서
서빙한다. 별도의 프런트엔드 배포는 필요 없다.

## 홈랩 온보딩

1. 앱 저장소 워크플로로 첫 이미지를 빌드·푸시한다.
2. 홈랩에서 `page` 데이터베이스를 만들고 migrator/runtime 자격증명을 분리 프로비저닝한다. migrator 자격증명은 스키마를 소유하고 DDL을 실행할 수 있지만, runtime 자격증명은 시작 시 마이그레이션이 만든 grant만 받아야 한다.
3. `.env`에 `DATABASE_URL`, `MIGRATE_DATABASE_URL`, `ADMIN_TOKEN_SHA256`을 분리해 넣는다. `DATABASE_URL`은 runtime 역할로, 스키마를 소유하거나 DDL 권한을 가져선 안 된다. `MIGRATE_DATABASE_URL`은 시작 시 마이그레이션과 runtime 권한 부여에만 쓰이는 migrator 역할이다. 프로덕션 관리 토큰은 최소 32바이트 난수로 생성하고, 사람이 고른 토큰을 쓰지 말며, 원시 토큰을 argv에 두지 마라:

```bash
ADMIN_TOKEN="$(openssl rand -base64 32)"
printf 'Store this admin token in the password manager now: %s\n' "$ADMIN_TOKEN"
printf 'ADMIN_TOKEN_SHA256=%s\n' "$(printf '%s' "$ADMIN_TOKEN" | bun run token:hash)" >> .env
unset ADMIN_TOKEN
```

4. `bun run secret:seal`을 실행해 `deploy/page-secrets.sealed.yaml`을 만든다. sealed 파일의 `spec.encryptedData` 키가 시크릿 키 목록이며, `.app-config.yml`은 개별 시크릿을 선언하지 않는다.
5. sealed 파일로 `ukyi-app/page`에 대해 홈랩 `create-app`을 실행한다.
6. 공유 `ghcr-pull` imagePullSecret을 통해 비공개 GHCR pull이 되는지 확인한다.
7. `/health`가 green이 된 뒤에만 DNS/tunnel을 활성화한다.
