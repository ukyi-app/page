# Hono + NestJS식 클래스 아키텍처 리팩토링 설계

**Date:** 2026-06-29
**Status:** Approved by user in hardened-planning Phase A

## 목표와 범위

`page`(html-runner) 서비스를 **외부 HTTP 계약을 byte-identical하게 유지**하면서, 내부를
Hono 위의 **module / service / controller 클래스 + tsyringe 데코레이터 DI + 데코레이터 라우팅**
으로 재구성한다. 순수 리팩토링이며 새 기능·엔드포인트·에러 메시지·헤더 변경은 없다.

확정된 결정:

| 영역 | 결정 |
|---|---|
| 웹 프레임워크 | Hono (`app.fetch`를 `Bun.serve`에 연결) |
| DI | tsyringe + reflect-metadata, `@injectable`/생성자 주입 |
| 라우팅 | 데코레이터 라우팅 `@Controller/@Get/@Put/@Post/@UseGuard` + 자작 RouterFactory |
| 모듈화 | 완전한 NestJS식: AppModule이 PagesModule·HealthModule 집계, core 계층 전부 클래스화 |
| 계약 보존 | 엄격 보존(순수 리팩토링) — 외부 동작 byte-identical |
| 테스트 | 새 구조로 재작성하되 기존 assertion을 1:1 이식(커버리지 패리티) |

## 현행 아키텍처 (리팩토링 대상)

- `src/index.ts` — 절차형 부트스트랩(config→pool→migrate→repo→server→`Bun.serve`).
- `src/server.ts` — `createServer({config,pages})`→`{fetch}`. `if`문 라우팅 + 핸들러 + 요청 파싱
  + 에러 매핑 + 응답 헬퍼 + `withReadDeadline`가 한 파일(248줄)에 과밀. **주 분해 대상.**
- `src/pageRepository.ts` — `PageRepository`(이미 class, Pool 주입, 트랜잭션/낙관적 잠금).
- `src/auth.ts` — `isAuthorized`(상수시간 Bearer 비교).
- `src/config.ts` — `loadConfig(env)`→`AppConfig`(env 검증).
- `src/db.ts` — `createPool`, `migrate`(런타임 role grant 포함).
- `src/path.ts` / `src/renderHeaders.ts` — 경로 정규화 / CSP 헤더.

## 타깃 구조

```
src/
  main.ts                      # 부트스트랩: reflect-metadata → container → migrate → AppModule.build → Bun.serve
  app.module.ts                # AppModule: 모듈 집계 + 루트 Hono 앱 + 전역 onError(ExceptionFilter)
  core/
    config/config.service.ts   # ConfigService (loadConfig 로직 이전, @injectable 싱글턴)
    database/database.module.ts# 런타임 Pool 프로바이더(ConfigService 기반) + db.ts 이전
    http/
      decorators.ts            # @Controller @Get @Put @Post @UseGuard (reflect-metadata에 라우트 메타 저장)
      router.factory.ts        # RouterFactory: 메타→Hono 등록 + 가드 미들웨어 + 405 폴백 (핵심 신규 코드)
      exception.filter.ts      # 에러→Response 매핑 (Hono onError)
      http-errors.ts           # HttpException 계층: BadRequestError(code)/RequestTooLargeError
      bounded-json.ts          # readBoundedJson (content-length 선검사 + 스트리밍 캡 + parse)
    auth/auth.guard.ts         # AuthGuard(Hono 미들웨어) + 상수시간 Bearer 비교
    path/page-path.ts          # canonicalizePagePath / isReservedPath (유지)
    render/render-headers.ts   # CSP 헤더 (유지)
  modules/
    pages/
      pages.module.ts          # PagesModule: 컨트롤러·서비스·레포 등록
      pages.admin.controller.ts# @Controller('/api/pages') @UseGuard(AuthGuard) + @Put/@Get/@Post
      page-render.controller.ts# @Controller() @Get('*') 공개 렌더(와일드카드)
      pages.service.ts         # 오케스트레이션 + withReadDeadline(읽기 전용) + 비즈니스 규칙
      pages.repository.ts      # PageRepository 이전(@injectable, Pool 주입), PageConflict/NotFoundError
    health/
      health.module.ts
      health.controller.ts     # @Controller() @Get('/health')
```

## 레이어 책임

- **Controller** — HTTP 파싱/검증 → 입력 구성 → Service 호출. 타입 에러를 던지고 ExceptionFilter가 매핑.
- **Service** — 오케스트레이션. 읽기에는 `withReadDeadline(operation, dbOperationTimeoutMs, …)` 적용,
  쓰기(save/rollback)는 직접 호출(statement_timeout + 트랜잭션 롤백에 의존). 비즈니스 규칙 담당.
- **Repository** — 트랜잭션/낙관적 잠금/SQL(현행 `PageRepository` 그대로).
- **Module** — tsyringe 컨테이너에 프로바이더·컨트롤러 등록. NestJS `imports` 에뮬레이션.

## DI & 데코레이터 라우팅 메커니즘

- **DI**: `tsyringe` + `reflect-metadata`. `@injectable()` 클래스, 생성자 주입. Pool·ConfigService는
  컨테이너 토큰으로 등록. tsconfig에 `experimentalDecorators:true`, `emitDecoratorMetadata:true` 추가.
  `main.ts`와 테스트 preload에서 `reflect-metadata`를 **최우선** import(데코레이터 클래스 로드 전).
- **RouterFactory(직접 구현)**: `@Controller(base)`·`@Get/@Put/@Post(path)`·`@UseGuard(Guard)`
  메타데이터를 읽어 컨트롤러 인스턴스를 Hono에 바인딩. 가드는 base + `/*`에 `app.use`로 **핸들러보다
  먼저** 적용(인증→바디 순서 보존).

### RouterFactory 등록 순서 불변식 (필수)

Hono의 라우팅 우선순위는 **등록 순서**다(겹치는 패턴은 먼저 등록된 핸들러가 매칭/실행되어 승리).
"정적이 와일드카드보다 우선"이라는 가정은 **틀렸으며**, 렌더 `@Get('*')`를 먼저 등록하면 `/health`·
admin 라우트를 선점한다. 따라서 RouterFactory는 모듈 import 순서가 아니라 **결정적 단계(phase/
priority)로 다음 순서를 강제**한다:

1. AuthGuard 미들웨어: `/api/pages` + `/api/pages/*`
2. admin **정확** 라우트: `PUT /api/pages`, `GET /api/pages`, `GET /api/pages/revisions`, `POST /api/pages/rollback`
3. **admin-prefix 405 catch-all**: `all('/api/pages')` + `all('/api/pages/*')` → 405 (가드 뒤 실행 →
   미인증 401, 인증된 미지원 메서드/하위경로 → 405). ← 인증된 `GET /api/pages/foo`가 렌더로 새어
   404가 되는 회귀를 차단하는 핵심.
4. health 정확 라우트 + health 405 catch-all (`all('/health')`)
5. 렌더 와일드카드 `get('*')` — **반드시 모든 예약/정적 라우트 뒤에** 등록
6. 전역 `all('*')` 405 폴백 — 렌더 뒤

렌더 와일드카드는 어떤 경우에도 예약/정적 라우트보다 먼저 등록되지 않는다(RouterFactory가 단계로 보장).

## 요청 수명주기 & 충실도 제약(불변) — 테스트가 곧 명세

| # | 제약 | 보존 방법 |
|---|---|---|
| F1 | 인증은 바디 읽기·레포 접근보다 먼저(`401`, 미인증 시 레포 호출 0회) | AuthGuard를 `/api/pages`,`/api/pages/*`에 미들웨어로 |
| F2 | 미인증 + 거대 content-length → `401`(413 아님) | 가드가 핸들러 진입 전 차단 |
| F3 | 파싱 전 크기 초과 → `413`(content-length + 스트리밍 캡) | `readBoundedJson` 유지(Hono `c.req.json()` 미사용) |
| F4 | `missing_body`/`invalid_json`/`invalid_path`/`invalid_revision_id`/`invalid_expected_content_sha256`/`invalid_body` → 각 `400`, 레포 접근 0회 | 현행 검증 로직 그대로 이전(zod 미도입) |
| F5 | htmlMaxBytes 초과 → `413 payload_too_large` | 현행 byteLength 검사 유지 |
| F6 | 읽기(getCurrentPage/Metadata/listRevisions)만 `withReadDeadline`→행/예외 시 `503`; 쓰기(save/rollback)는 미적용 | Service에서 읽기에만 데드라인 |
| F7 | 충돌 → `409 {error:"conflict", current:{path,revisionId,contentSha256,updatedAt}}`(html 제거) | ExceptionFilter에서 stripHtml |
| F8 | 레포 실패 → `503 {error:"service_unavailable"}` + `console.error("repository failure",…)` | ExceptionFilter 기본 분기 |
| F9 | 렌더: 정규화 실패/예약/미존재 → `404`; 성공 → `200`+정확한 html+CSP 헤더 | PageRenderController + renderHeaders |
| F10 | 405 정밀도: `/health` 비-GET→405 · (인증 후) admin 미지원 메서드/하위경로(`/api/pages/foo`)→405 · 임의 경로 비-GET→405 · `/api/foo` GET→404(예약) | RouterFactory **등록 순서 불변식**(위) + admin-prefix 405 catch-all. 미인증 `/api/pages/foo`는 가드가 401, 인증 시 catch-all이 405(렌더 404로 새지 않음) |

## 에러 처리

`http-errors.ts`의 타입 에러를 던지고 전역 `app.onError`(ExceptionFilter)가 매핑한다.
현행 `mapRouteError`/`repositoryFailure`와 동치:

- `RequestTooLargeError` → `413 {error:"payload_too_large"}`
- `BadRequestError(code)` → `400 {error: code}`
- `PageConflictError` → `409 {error:"conflict", current?: stripHtml(current)}`
- `PageNotFoundError` → `404 {error:"not_found"}`
- 그 외 → `503 {error:"service_unavailable"}` + `console.error("repository failure", {operation, error})`

## 데이터 모델 / 도메인 로직

현행 유지(변경 없음). `pages` + `page_revisions` 2테이블, 시작 시 idempotent 마이그레이션,
런타임 role grant. 저장은 리비전 선생성 후 같은 트랜잭션에서 current 포인터 이동, 낙관적 잠금
(`expectedContentSha256`), 롤백은 대상 리비전 검증 후 포인터 이동. SHA-256 content hash.

## 테스트 전략 (재작성 + 커버리지 패리티)

- 신규 진입 헬퍼 `createApp({config, pages})`(또는 `AppModule.build`)가 자식 컨테이너에 테스트
  더블(ConfigService 인스턴스 + PageRepository 더블)을 등록하고 Hono 앱을 반환 → 기존
  `createServer({config,pages})`를 대체.
- **포팅**: `server.test.ts`·`serverRoutes.test.ts`·`auth`·`config`·`path`·`renderHeaders`·`db`
  테스트의 모든 assertion을 새 구조로 1:1 이식.
- **신규 필수**: `router.factory.test.ts`(자작 프레임워크 코드 — 라우트 등록, 가드 적용, **등록 순서
  불변식**, 405 폴백). 반드시 포함할 케이스: `/health` GET/비-GET, `/api/pages/foo` 인증 유(405)/무(401),
  `rollback` 잘못된 메서드(405), 렌더 와일드카드가 정적/예약 라우트를 선점하지 않음, 전역 비-GET→405.
  `pages.service.test.ts`(withReadDeadline·에러 전파).
- 플랜 산출물로 **충실도 체크리스트(F1–F10) + 기존 assertion→신규 테스트 매핑표**를 강제.

## 의존성·설정 변경

- `package.json`: `hono`, `tsyringe`, `reflect-metadata` 추가(`pg` 유지).
- `tsconfig.json`: `experimentalDecorators:true`, `emitDecoratorMetadata:true`.
- `bunfig.toml`: 테스트 `preload=["reflect-metadata"]`.
- 엔트리 `src/index.ts`→`src/main.ts` 변경 시 Dockerfile·`package.json` 스크립트 참조 갱신.

## 리스크 & 디리스킹 순서 (플랜 1단계로 선행)

1. **Bun + emitDecoratorMetadata + tsyringe 런타임 호환** — 통과하는 스파이크 테스트로 가장 먼저
   검증. 실패 시 DI 방식 재논의(설계 에스컬레이션).
2. **RouterFactory의 405/404/401 우선순위 정밀 재현** — 최대 리스크 신규 코드. Hono는 등록 순서가
   계약이므로 위 "등록 순서 불변식"을 RouterFactory가 결정적으로 강제하고 F10 전용 테스트로 방어.
   (Phase A.5 설계 리뷰에서 high로 식별·수용된 항목.)
3. **테스트 재작성 커버리지 누락** — assertion 매핑표로 방어.

## 범위 외 (YAGNI)

`/healthz`·`/readyz` 전환, zod, DELETE 엔드포인트, 외부 리소스 CSP 완화, 데코레이터 기반 검증
파이프는 모두 제외(엄격 보존).

## 대안 검토 메모

- DI: awilix(비데코레이터)·수동 생성자 주입도 후보였으나 사용자 선택대로 tsyringe 데코레이터 채택.
- 라우팅: 명시적 `routes()` 등록이 더 낮은 리스크였으나 NestJS 충실도를 위해 데코레이터 라우팅 채택
  → RouterFactory 전용 테스트로 리스크 상쇄.

## Phase A.5 설계 리뷰 판정 (감사 기록)

codex 설계 리뷰(`--kind design`, `ok:true`/`planInDiff:true`/verdict `needs-attention`) — high 1건.

- **[high] RouterFactory precedence cannot safely preserve 404/405/401** — **수용**.
  Hono 라우팅 우선순위는 등록 순서이며 "정적 우선" 가정이 오류. 인증된 `GET /api/pages/foo`가 렌더
  와일드카드에 먹혀 현행 405 대신 404가 되는 회귀를 현행 코드로 재현 확인. 데코레이터 라우팅 접근은
  유지하되 위 "RouterFactory 등록 순서 불변식" + admin-prefix 405 catch-all + 전용 테스트로 보강.
  (사용자 승인 후 본 문서에 반영·재승인.)
