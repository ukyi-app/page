# Hono + NestJS식 클래스 아키텍처 리팩토링 구현 플랜

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `page`(html-runner) 서비스의 외부 HTTP 계약을 byte-identical하게 유지하면서 내부를 Hono + tsyringe 데코레이터 DI + 데코레이터 라우팅 기반의 module/service/controller 클래스 구조로 재구성한다.

**Architecture:** 병렬 빌드 + 원자적 크로스오버. 기존 `src/*`와 기존 테스트는 빌드 내내 손대지 않고 green으로 유지(안전망)하고, 새 구조를 독립 경로(`src/core`, `src/modules`, `src/app.module.ts`, `src/main.ts`)에 TDD로 구축한다. 신규 테스트는 기존 테스트의 모든 assertion을 1:1 이식한다. 마지막 크로스오버 태스크에서 엔트리 전환 + 구 파일/구 테스트 삭제로 한 번에 교체한다.

**Tech Stack:** Bun, TypeScript, Hono(라우팅/서버), tsyringe + reflect-metadata(DI), pg(Postgres), bun:test.

---

## 설계 출처

확정 설계: `docs/plans/2026-06-29-hono-refactor-design.md` (Phase A 승인 + Phase A.5 리뷰 반영). 이 플랜은 그 설계를 구현 단계로 분해한 것이며, 특히 **충실도 제약 F1–F10**과 **RouterFactory 등록 순서 불변식**을 그대로 구현·검증한다.

## 충실도 제약 (불변 — 테스트가 곧 명세)

| # | 제약 |
|---|---|
| F1 | 인증은 바디 읽기·레포 접근보다 먼저(`401`, 미인증 시 레포 호출 0회) |
| F2 | 미인증 + 거대 content-length → `401`(413 아님) |
| F3 | 파싱 전 크기 초과 → `413`(content-length + 스트리밍 캡) — `readBoundedJson` 사용, Hono `c.req.json()` 미사용 |
| F4 | `missing_body`/`invalid_json`/`invalid_path`/`invalid_revision_id`/`invalid_expected_content_sha256`/`invalid_body` → 각 `400`, 레포 접근 0회 |
| F5 | htmlMaxBytes 초과 → `413 {error:"payload_too_large"}` |
| F6 | 읽기(getCurrentPage/Metadata/listRevisions)만 `withReadDeadline`→행/예외 시 `503`; 쓰기(save/rollback)는 미적용 |
| F7 | 충돌 → `409 {error:"conflict", current:{path,revisionId,contentSha256,updatedAt}}`(html 제거) |
| F8 | 레포 실패 → `503 {error:"service_unavailable"}` + `console.error("repository failure", …)` |
| F9 | 렌더: 정규화 실패/예약/미존재 → `404 {error:"not_found"}`; 성공 → `200`+정확한 html+CSP 헤더 |
| F10 | 405 정밀도: `/health` 비-GET→405 · (인증 후) admin 미지원 메서드/하위경로(`/api/pages/foo`)→405 · 임의 경로 비-GET→405 · `/api/foo` GET→404(예약). 미인증 `/api/pages/foo`는 가드가 401 |

## RouterFactory 등록 순서 불변식 (결정적, 모듈 import 순서와 무관)

1. **가드 미들웨어**: 가드 있는 컨트롤러의 base + base/`*`
2. **정확(비-와일드카드) 라우트**: 모든 컨트롤러의 `*` 없는 라우트
3. **405 catch-all**: base가 비어있지 않은 컨트롤러는 `all(base)`+`all(base/*)`; base가 빈 컨트롤러는 정확 라우트별 `all(path)`
4. **와일드카드 라우트**: `*` 포함 라우트(렌더 `get('*')`)
5. **전역 폴백**: `all('*')` → 405

→ 정확/예약 라우트는 항상 와일드카드보다 먼저, 전역 405는 항상 마지막. 인증된 `GET /api/pages/foo`는 3단계 `all('/api/pages/*')`(405)가 4단계 렌더 `get('*')`보다 먼저 등록되어 404로 새지 않는다.

## 작업 규칙

- **TDD**: 각 태스크는 테스트 먼저 → 실패 확인 → 최소 구현 → 통과 확인 → 커밋.
- **빌드 중 안전망**: 크로스오버(Task 20) 전까지 `src/server.ts`·`src/index.ts`·`src/*.ts`(기존)와 `tests/unit/*`·`tests/integration/*`(기존)를 **수정·삭제하지 않는다**. 항상 `bun run test:unit` + `bun run typecheck`가 green이어야 한다.
- **신규 테스트 위치**: 단위는 `tests/unit/<new-path>.test.ts`, 통합은 `tests/integration/<name>.test.ts`.
- **통합 테스트 실행**: `ALLOW_TEST_DB_RESET=1 bun run test:integration` (Postgres는 `docker compose -f docker-compose.test.yaml up -d`로 `localhost:15432`에 기동, 이미 떠 있으면 재사용).
- **커밋(직접 실행, `Skill(commit)` 사용 금지)**: 한국어, `type(scope): 설명`, AI 마커 없음, 타입은 `feat|fix|refactor|docs|style|test|chore`만. 현재 worktree 브랜치 `refactor/hono-nestjs`에 직접 커밋.
- **import "reflect-metadata"**: 데코레이터/Reflect를 쓰는 새 파일 최상단과 `src/main.ts` 최상단에 둔다(중복 import는 idempotent). 테스트는 `bunfig.toml` preload로 보장.
- **응답은 native 헬퍼로**: 모든 컨트롤러·필터·405 폴백은 `core/http/responses.ts`의 `json()`/`error()`(native `Response.json` 기반, 구 `server.ts:152-158`와 동일)를 사용한다. **Hono `c.json` 금지** — `c.json`은 content-type가 구 `Response.json`과 달라(`application/json; charset=UTF-8` vs `application/json;charset=utf-8`) byte-identical 계약을 깨고 Task 19b 차등 테스트를 실패시킨다.

## 커버리지 패리티 매핑 (기존 assertion → 신규 테스트)

| 기존 테스트 | 신규 테스트 | 비고 |
|---|---|---|
| `tests/unit/path.test.ts` | `tests/unit/core/page-path.test.ts` | canonicalize/reserved |
| `tests/unit/renderHeaders.test.ts` | `tests/unit/core/render-headers.test.ts` | CSP 헤더 |
| `tests/unit/auth.test.ts` | `tests/unit/core/auth-token.test.ts` | 상수시간 Bearer |
| `tests/unit/config.test.ts` | `tests/unit/core/config.test.ts` | loadConfig 검증 |
| `tests/unit/db.test.ts` | `tests/unit/core/db.test.ts` | role/quote/grant |
| `tests/unit/server.test.ts` | `tests/unit/app.test.ts` (createApp 기반) | F1–F10 전부 + 신규 405 케이스 |
| `tests/integration/pageRepository.test.ts` | `tests/integration/pages.repository.test.ts` | 레포 트랜잭션/충돌 |
| `tests/integration/serverRoutes.test.ts` | `tests/integration/app.routes.test.ts` (createApp 기반) | 전체 라우트 + 타임아웃/롤백 |
| (신규) | `tests/unit/core/router-factory.test.ts` | 등록 순서/가드/405 |
| (신규) | `tests/unit/core/bounded-json.test.ts` | content-length/스트리밍 캡/parse |
| (신규) | `tests/unit/modules/pages-service.test.ts` | withReadDeadline 읽기 전용 |
| (신규) | `tests/unit/core/responses.test.ts` | native json/error 헬퍼 |
| (신규, 일회성) | `tests/unit/contract-parity.test.ts` | 구↔신 status·바디·헤더 차등(크로스오버 전 게이트, Task 20에서 제거) |

---

## Task 0: DI 기반 마련 + 스파이크 (디리스킹 — 먼저)

**Files:**
- Modify: `package.json` (deps)
- Modify: `tsconfig.json`
- Create: `bunfig.toml`
- Create: `tests/unit/core/di-spike.test.ts`

**Step 1: 의존성 추가**

Run:
```bash
cd /Users/ukyi/workspace/page/.worktrees/hono-refactor
bun add hono tsyringe reflect-metadata
```
Expected: `hono`, `tsyringe`, `reflect-metadata`가 `package.json` dependencies에 추가, `bun.lock` 갱신.

**Step 2: tsconfig에 데코레이터 옵션 추가**

`tsconfig.json`의 `compilerOptions`에 두 줄 추가:
```json
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
```
(기존 옵션 유지: target ES2022, module ESNext, moduleResolution Bundler, strict, skipLibCheck, types:["bun"], noEmit. `include`도 유지.)

**Step 3: bunfig.toml 생성 (테스트 preload)**

Create `bunfig.toml`:
```toml
[test]
preload = ["reflect-metadata"]
```

**Step 4: 실패하는 DI 스파이크 테스트 작성**

Create `tests/unit/core/di-spike.test.ts`:
```ts
import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import { container, inject, injectable } from "tsyringe";

@injectable()
class SpikeDep {
  value(): number {
    return 42;
  }
}

@injectable()
class SpikeService {
  constructor(public readonly dep: SpikeDep) {}
}

const SPIKE_TOKEN = Symbol("SPIKE_TOKEN");

@injectable()
class SpikeConsumer {
  constructor(@inject(SPIKE_TOKEN) public readonly injected: { n: number }) {}
}

describe("DI foundation (tsyringe on Bun)", () => {
  test("resolves constructor-injected dep via design:paramtypes metadata", () => {
    const svc = container.resolve(SpikeService);
    expect(svc.dep.value()).toBe(42);
  });

  test("resolves token-injected instance from a child container", () => {
    const child = container.createChildContainer();
    child.registerInstance(SPIKE_TOKEN, { n: 7 });
    expect(child.resolve(SpikeConsumer).injected.n).toBe(7);
  });
});
```

**Step 5: 실행해서 통과 확인 (디리스킹 게이트)**

Run: `bun test tests/unit/core/di-spike.test.ts`
Expected: 2 pass. **만약 첫 테스트가 실패하면(`design:paramtypes`/emitDecoratorMetadata 미동작) STOP — 설계 리스크 #1이 현실화된 것이므로 DI 방식 재논의가 필요하다(데코레이터 DI를 수동 주입으로 전환 등). 이 게이트를 통과하지 못하면 이후 태스크를 진행하지 말 것.**

**Step 6: 기존 안전망 유지 확인**

Run: `bun run typecheck && bun run test:unit`
Expected: typecheck 0 errors, unit 49 pass (기존 테스트 영향 없음).

**Step 7: 커밋**
```bash
git add package.json bun.lock tsconfig.json bunfig.toml tests/unit/core/di-spike.test.ts
git commit -m "chore: hono·tsyringe 의존성 및 데코레이터 DI 기반 추가" -m "- hono, tsyringe, reflect-metadata 추가
- tsconfig experimentalDecorators/emitDecoratorMetadata, bunfig 테스트 preload
- Bun DI 동작 스파이크 테스트로 디리스킹"
```

---

## Task 1: HTTP 에러 계층 (`core/http/http-errors.ts`)

`src/server.ts:166-172`의 `RequestTooLargeError`/`BadRequestError`를 옮긴다.

**Files:**
- Create: `src/core/http/http-errors.ts`
- Create: `tests/unit/core/http-errors.test.ts`

**Step 1: 실패 테스트**
```ts
import { describe, expect, test } from "bun:test";
import { BadRequestError, RequestTooLargeError } from "../../../src/core/http/http-errors";

describe("http-errors", () => {
  test("BadRequestError carries a stable code", () => {
    const err = new BadRequestError("invalid_path");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("invalid_path");
  });
  test("RequestTooLargeError is an Error", () => {
    expect(new RequestTooLargeError()).toBeInstanceOf(Error);
  });
});
```

**Step 2: 실패 확인** — `bun test tests/unit/core/http-errors.test.ts` → FAIL(모듈 없음).

**Step 3: 구현**
```ts
export class RequestTooLargeError extends Error {}

export class BadRequestError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
```

**Step 4: 통과 확인** — `bun test tests/unit/core/http-errors.test.ts` → 2 pass.

**Step 5: 커밋**
```bash
git add src/core/http/http-errors.ts tests/unit/core/http-errors.test.ts
git commit -m "feat: HTTP 에러 계층 추가"
```

---

## Task 2: bounded JSON 리더 (`core/http/bounded-json.ts`)

`src/server.ts`의 `byteLength`(160-162), `readBoundedJson`(174-199), `concat`(201-209)를 옮긴다. 에러는 Task 1에서 import.

**Files:**
- Create: `src/core/http/bounded-json.ts`
- Create: `tests/unit/core/bounded-json.test.ts`

**Step 1: 실패 테스트** (F3 핵심: content-length 선검사, 스트리밍 캡, parse 에러 코드)
```ts
import { describe, expect, test } from "bun:test";
import { byteLength, readBoundedJson } from "../../../src/core/http/bounded-json";
import { BadRequestError, RequestTooLargeError } from "../../../src/core/http/http-errors";

function req(body: string | null, headers: Record<string, string> = {}): Request {
  return new Request("https://x.test/", { method: "PUT", body: body ?? undefined, headers });
}

describe("bounded-json", () => {
  test("byteLength counts UTF-8 bytes", () => {
    expect(byteLength('"'.repeat(100))).toBe(100);
  });
  test("parses small JSON", async () => {
    expect(await readBoundedJson(req(JSON.stringify({ a: 1 })), 1000)).toEqual({ a: 1 });
  });
  test("rejects oversized content-length before parsing", async () => {
    const r = req(JSON.stringify({ a: 1 }), { "content-length": "1000000" });
    await expect(readBoundedJson(r, 100)).rejects.toBeInstanceOf(RequestTooLargeError);
  });
  test("rejects oversized streamed body", async () => {
    await expect(readBoundedJson(req("x".repeat(200)), 100)).rejects.toBeInstanceOf(RequestTooLargeError);
  });
  test("missing body -> missing_body", async () => {
    const r = new Request("https://x.test/", { method: "PUT" });
    await expect(readBoundedJson(r, 100)).rejects.toMatchObject({ code: "missing_body" });
  });
  test("invalid json -> invalid_json", async () => {
    await expect(readBoundedJson(req("{"), 100)).rejects.toMatchObject({ code: "invalid_json" });
  });
});
```

**Step 2: 실패 확인.**

**Step 3: 구현** (`src/server.ts:160-209`에서 옮김 + 에러 import)
```ts
import { BadRequestError, RequestTooLargeError } from "./http-errors";

export function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new RequestTooLargeError();
  }

  const reader = request.body?.getReader();
  if (!reader) throw new BadRequestError("missing_body");

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) throw new RequestTooLargeError();
    chunks.push(value);
  }

  const raw = new TextDecoder().decode(concat(chunks, total));
  try {
    return JSON.parse(raw);
  } catch {
    throw new BadRequestError("invalid_json");
  }
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
```

**Step 4: 통과 확인.**

**Step 5: 커밋**
```bash
git add src/core/http/bounded-json.ts tests/unit/core/bounded-json.test.ts
git commit -m "feat: bounded JSON 리더 추가"
```

---

## Task 2b: 응답 헬퍼 (`core/http/responses.ts`) — byte-identical 보장

`src/server.ts:152-158`의 `json`/`error`를 옮긴다(native `Response.json` 기반). 모든 컨트롤러·필터·405 폴백이 이걸 사용해 구 응답과 byte-identical(특히 JSON content-type)을 보장한다.

**Files:**
- Create: `src/core/http/responses.ts`
- Create: `tests/unit/core/responses.test.ts`

**Step 1: 실패 테스트**
```ts
import { describe, expect, test } from "bun:test";
import { error, json } from "../../../src/core/http/responses";

describe("responses", () => {
  test("json sets native Response.json content-type and status", async () => {
    const r = json({ a: 1 }, 201);
    expect(r.status).toBe(201);
    // 구 Response.json과 동일한 content-type (Bun native)
    expect(r.headers.get("content-type")).toBe(Response.json({ a: 1 }).headers.get("content-type"));
    expect(await r.json()).toEqual({ a: 1 });
  });
  test("error wraps code + extra", async () => {
    const r = error("conflict", 409, { current: { path: "/d" } });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "conflict", current: { path: "/d" } });
  });
  test("error default has only the code", async () => {
    expect(await error("not_found", 404).json()).toEqual({ error: "not_found" });
  });
});
```

**Step 2: 실패 확인.**

**Step 3: 구현** (= `src/server.ts:152-158`)
```ts
export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export function error(code: string, status: number, extra: Record<string, unknown> = {}): Response {
  return json({ error: code, ...extra }, status);
}
```

**Step 4: 통과 확인** — `bun test tests/unit/core/responses.test.ts` → 3 pass.

**Step 5: 커밋**
```bash
git add src/core/http/responses.ts tests/unit/core/responses.test.ts
git commit -m "feat: native 응답 헬퍼 추가"
```

---

## Task 3: 경로 정규화 (`core/path/page-path.ts`)

`src/path.ts` 전체를 그대로 옮긴다(코드 변경 없음).

**Files:**
- Create: `src/core/path/page-path.ts` (내용은 `src/path.ts`와 동일: `canonicalizePagePath`, `isReservedPath`, `PAGE_PATH_RE`, `RESERVED_EXACT`)
- Create: `tests/unit/core/page-path.test.ts` (= `tests/unit/path.test.ts` 내용, import 경로만 `../../../src/core/path/page-path`로 변경)

**Step 1:** 신규 테스트 작성(기존 path.test.ts의 모든 케이스 이식, import 변경) → **Step 2:** 실패 확인 → **Step 3:** `src/path.ts` 내용 복사해 새 파일 생성 → **Step 4:** `bun test tests/unit/core/page-path.test.ts` 통과 → **Step 5:** 커밋
```bash
git add src/core/path/page-path.ts tests/unit/core/page-path.test.ts
git commit -m "feat: 페이지 경로 정규화 모듈 추가"
```

---

## Task 4: 렌더 헤더 (`core/render/render-headers.ts`)

`src/renderHeaders.ts` 전체를 그대로 옮긴다.

**Files:**
- Create: `src/core/render/render-headers.ts` (= `src/renderHeaders.ts` 내용)
- Create: `tests/unit/core/render-headers.test.ts` (= `tests/unit/renderHeaders.test.ts`, import 변경)

Step 1 테스트 이식 → Step 2 실패 → Step 3 복사 생성 → Step 4 통과 → Step 5 커밋
```bash
git add src/core/render/render-headers.ts tests/unit/core/render-headers.test.ts
git commit -m "feat: 렌더 보안 헤더 모듈 추가"
```

---

## Task 5: 인증 토큰 검증 (`core/auth/auth-token.ts`)

`src/auth.ts`의 `isAuthorized`를 `verifyBearerToken`으로 옮긴다(로직 동일, 이름만 명확화).

**Files:**
- Create: `src/core/auth/auth-token.ts`
- Create: `tests/unit/core/auth-token.test.ts` (= `tests/unit/auth.test.ts`, import 변경 + 함수명 `verifyBearerToken`)

**Step 3 구현:**
```ts
import { createHash, timingSafeEqual } from "node:crypto";

export async function verifyBearerToken(request: Request, expectedSha256Hex: string): Promise<boolean> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;
  const token = header.slice("Bearer ".length);
  if (!token) return false;

  const actual = createHash("sha256").update(token).digest();
  const expected = Buffer.from(expectedSha256Hex, "hex");
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}
```
커밋:
```bash
git add src/core/auth/auth-token.ts tests/unit/core/auth-token.test.ts
git commit -m "feat: Bearer 토큰 상수시간 검증 모듈 추가"
```

---

## Task 6: 설정 (`core/config/config.ts` + `config.service.ts`)

`src/config.ts`(AppConfig + loadConfig)를 `src/core/config/config.ts`로 그대로 옮기고, 이를 감싸는 `ConfigService`를 추가한다.

**Files:**
- Create: `src/core/config/config.ts` (= `src/config.ts` 내용)
- Create: `src/core/config/config.service.ts`
- Create: `tests/unit/core/config.test.ts` (= `tests/unit/config.test.ts`, import 변경)
- Create: `tests/unit/core/config-service.test.ts`

**Step 3a: config.ts** — `src/config.ts` 내용 복사(변경 없음).

**Step 3b: config.service.ts**
```ts
import "reflect-metadata";
import { injectable } from "tsyringe";
import type { AppConfig } from "./config";

@injectable()
export class ConfigService {
  constructor(private readonly cfg: AppConfig) {}
  get port(): number { return this.cfg.port; }
  get databaseUrl(): string { return this.cfg.databaseUrl; }
  get migrateDatabaseUrl(): string { return this.cfg.migrateDatabaseUrl; }
  get adminTokenSha256(): string { return this.cfg.adminTokenSha256; }
  get htmlMaxBytes(): number { return this.cfg.htmlMaxBytes; }
  get jsonMaxBytes(): number { return this.cfg.jsonMaxBytes; }
  get dbConnectionTimeoutMs(): number { return this.cfg.dbConnectionTimeoutMs; }
  get dbStatementTimeoutMs(): number { return this.cfg.dbStatementTimeoutMs; }
  get dbOperationTimeoutMs(): number { return this.cfg.dbOperationTimeoutMs; }
}
```

**Step 1 (config-service.test.ts):**
```ts
import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import type { AppConfig } from "../../../src/core/config/config";
import { ConfigService } from "../../../src/core/config/config.service";

const sample: AppConfig = {
  port: 8080, databaseUrl: "postgres://x", migrateDatabaseUrl: "postgres://x",
  adminTokenSha256: "a".repeat(64), htmlMaxBytes: 100, jsonMaxBytes: 700,
  dbConnectionTimeoutMs: 2000, dbStatementTimeoutMs: 3000, dbOperationTimeoutMs: 3500,
};

describe("ConfigService", () => {
  test("exposes config values via getters", () => {
    const c = new ConfigService(sample);
    expect(c.htmlMaxBytes).toBe(100);
    expect(c.dbOperationTimeoutMs).toBe(3500);
    expect(c.adminTokenSha256).toBe("a".repeat(64));
  });
});
```

Step 2 실패 → Step 3 구현 → Step 4 `bun test tests/unit/core/config.test.ts tests/unit/core/config-service.test.ts` 통과 → Step 5 커밋
```bash
git add src/core/config/config.ts src/core/config/config.service.ts tests/unit/core/config.test.ts tests/unit/core/config-service.test.ts
git commit -m "feat: 설정 로더 및 ConfigService 추가"
```

---

## Task 7: 데이터베이스 (`core/database/db.ts`)

`src/db.ts` 전체를 그대로 옮기고(코드 동일: `createPool`, `migrate`, `runtimeRoleFromDatabaseUrl`, `quoteIdentifier`, `DbTimeouts`, `MIGRATION_LOCK_KEY`), 공유 테스트 헬퍼 `helpers.ts`가 새 위치를 쓰도록 import를 리다이렉트한다.

**Files:**
- Create: `src/core/database/db.ts` (= `src/db.ts` 내용)
- Create: `tests/unit/core/db.test.ts` (= `tests/unit/db.test.ts`, import 변경)
- Modify: `tests/integration/helpers.ts` (`import { migrate } from "../../src/db"` → `"../../src/core/database/db"`)

> 안전 예외: `helpers.ts`는 기존 테스트 지원 파일이지만 migrate 코드가 동일하므로, import만 새 경로로 바꿔도 구 통합 테스트(pageRepository/serverRoutes)가 그대로 green. 이렇게 일찍 단일 소스로 통일하면 크로스오버(Task 20) 시 `../../src/db` dangling 참조가 남지 않는다.

Step 1 테스트 이식 → Step 2 실패 → Step 3 `src/db.ts` 복사 생성 → Step 3b `helpers.ts`의 migrate import를 `../../src/core/database/db`로 변경 → Step 4 `bun test tests/unit/core/db.test.ts` 통과 + `ALLOW_TEST_DB_RESET=1 bun run test:integration`로 **구 통합 테스트 여전히 green** 확인 → Step 5 커밋
```bash
git add src/core/database/db.ts tests/unit/core/db.test.ts tests/integration/helpers.ts
git commit -m "feat: 데이터베이스 모듈 추가 및 테스트 헬퍼 경로 정리"
```

---

## Task 8: 라우팅 데코레이터 (`core/http/decorators.ts`)

**Files:**
- Create: `src/core/http/decorators.ts`
- Create: `tests/unit/core/decorators.test.ts`

**Step 1: 실패 테스트** (메타데이터 저장 검증)
```ts
import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import {
  Controller, Get, Post, Put, UseGuard,
  getControllerPath, getRoutes, getGuards,
} from "../../../src/core/http/decorators";

class FakeGuard { handle = async () => {}; }

@Controller("/api/pages")
@UseGuard(FakeGuard)
class Sample {
  @Put("") save() {}
  @Get("/revisions") list() {}
  @Post("/rollback") rollback() {}
}

describe("routing decorators", () => {
  test("records controller base path", () => {
    expect(getControllerPath(Sample)).toBe("/api/pages");
  });
  test("records routes with method/path/handler", () => {
    const routes = getRoutes(Sample);
    expect(routes).toEqual(
      expect.arrayContaining([
        { method: "put", path: "", handlerName: "save" },
        { method: "get", path: "/revisions", handlerName: "list" },
        { method: "post", path: "/rollback", handlerName: "rollback" },
      ]),
    );
    expect(routes).toHaveLength(3);
  });
  test("records guards", () => {
    expect(getGuards(Sample)).toEqual([FakeGuard]);
  });
});
```

**Step 2: 실패 확인.**

**Step 3: 구현**
```ts
import "reflect-metadata";
import type { MiddlewareHandler } from "hono";

export const CONTROLLER_PATH = Symbol("controller:path");
export const ROUTES = Symbol("controller:routes");
export const GUARDS = Symbol("controller:guards");

export type HttpMethod = "get" | "put" | "post";

export interface RouteDef {
  method: HttpMethod;
  path: string;
  handlerName: string;
}

export interface CanActivate {
  handle: MiddlewareHandler;
}

// DI 주입 가드(생성자 인자 있음)도 허용해야 하므로 any[] (NestJS Type<any> 패턴). never[]이면
// ConfigService 생성자를 가진 AuthGuard가 @UseGuard에 strict TS 비호환이 된다.
export type GuardClass = new (...args: any[]) => CanActivate;

// biome-ignore lint: tsyringe 데코레이터 타깃 타입
type Ctor = Function;

export function Controller(basePath = ""): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(CONTROLLER_PATH, basePath, target);
  };
}

function methodDecorator(method: HttpMethod) {
  return (path = ""): MethodDecorator =>
    (target, propertyKey) => {
      const ctor = target.constructor;
      const routes: RouteDef[] = Reflect.getOwnMetadata(ROUTES, ctor) ?? [];
      routes.push({ method, path, handlerName: String(propertyKey) });
      Reflect.defineMetadata(ROUTES, routes, ctor);
    };
}

export const Get = methodDecorator("get");
export const Put = methodDecorator("put");
export const Post = methodDecorator("post");

export function UseGuard(guard: GuardClass): ClassDecorator {
  return (target) => {
    const guards: GuardClass[] = Reflect.getOwnMetadata(GUARDS, target) ?? [];
    guards.push(guard);
    Reflect.defineMetadata(GUARDS, guards, target);
  };
}

export function getControllerPath(ctor: Ctor): string {
  return Reflect.getOwnMetadata(CONTROLLER_PATH, ctor) ?? "";
}
export function getRoutes(ctor: Ctor): RouteDef[] {
  return Reflect.getOwnMetadata(ROUTES, ctor) ?? [];
}
export function getGuards(ctor: Ctor): GuardClass[] {
  return Reflect.getOwnMetadata(GUARDS, ctor) ?? [];
}
```

**Step 4: 통과 확인.**

**Step 5: 커밋**
```bash
git add src/core/http/decorators.ts tests/unit/core/decorators.test.ts
git commit -m "feat: 라우팅·가드 데코레이터 추가"
```

---

## Task 9: RouterFactory (`core/http/router.factory.ts`) — 최대 리스크, F10

등록 순서 불변식을 결정적으로 강제하고 405 정밀도를 재현한다.

**Files:**
- Create: `src/core/http/router.factory.ts`
- Create: `tests/unit/core/router-factory.test.ts`

**Step 1: 실패 테스트** (F10 전체 — 가드 우선, 정적>와일드카드, admin-prefix 405, 전역 405)
```ts
import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { Context } from "hono";
import { container } from "tsyringe";
import { Controller, Get, Post, Put, UseGuard, type CanActivate } from "../../../src/core/http/decorators";
import { RouterFactory } from "../../../src/core/http/router.factory";

class DenyUnlessHeader implements CanActivate {
  handle = async (c: Context, next: () => Promise<void>) => {
    if (c.req.header("x-ok") !== "1") return c.json({ error: "unauthorized" }, 401);
    await next();
  };
}

@Controller("/api/pages")
@UseGuard(DenyUnlessHeader)
class AdminCtrl {
  @Put("") save(c: Context) { return c.json({ ok: "save" }); }
  @Get("") meta(c: Context) { return c.json({ ok: "meta" }); }
  @Get("/revisions") revs(c: Context) { return c.json({ ok: "revs" }); }
  @Post("/rollback") rollback(c: Context) { return c.json({ ok: "rollback" }); }
}

@Controller("")
class HealthCtrl {
  @Get("/health") health(c: Context) { return c.json({ ok: true }); }
}

@Controller("")
class RenderCtrl {
  @Get("*") render(c: Context) { return c.json({ rendered: c.req.path }); }
}

function build(): Hono {
  const child = container.createChildContainer();
  const app = new Hono();
  RouterFactory.register(app, [child.resolve(AdminCtrl), child.resolve(HealthCtrl), child.resolve(RenderCtrl)], child);
  return app;
}
function reqOf(path: string, method = "GET", headers: Record<string, string> = {}) {
  return new Request(`https://x.test${path}`, { method, headers });
}

describe("RouterFactory ordering invariants", () => {
  test("guard runs before admin handlers (401 without header)", async () => {
    const r = await build().fetch(reqOf("/api/pages", "PUT"));
    expect(r.status).toBe(401);
  });
  test("admin exact routes win over render wildcard (with auth)", async () => {
    const r = await build().fetch(reqOf("/api/pages", "GET", { "x-ok": "1" }));
    expect(await r.json()).toEqual({ ok: "meta" });
  });
  test("authed unknown admin subpath -> 405 (not render 404)", async () => {
    const r = await build().fetch(reqOf("/api/pages/foo", "GET", { "x-ok": "1" }));
    expect(r.status).toBe(405);
    expect(await r.json()).toEqual({ error: "method_not_allowed" });
  });
  test("unauthed unknown admin subpath -> 401 (guard first)", async () => {
    const r = await build().fetch(reqOf("/api/pages/foo", "GET"));
    expect(r.status).toBe(401);
  });
  test("authed wrong method on exact admin path -> 405", async () => {
    const r = await build().fetch(reqOf("/api/pages/rollback", "GET", { "x-ok": "1" }));
    expect(r.status).toBe(405);
  });
  test("GET /health -> handler", async () => {
    expect(await (await build().fetch(reqOf("/health"))).json()).toEqual({ ok: true });
  });
  test("non-GET /health -> 405", async () => {
    expect((await build().fetch(reqOf("/health", "POST"))).status).toBe(405);
  });
  test("GET arbitrary path -> render wildcard", async () => {
    expect(await (await build().fetch(reqOf("/demo"))).json()).toEqual({ rendered: "/demo" });
  });
  test("non-GET arbitrary path -> 405 (global fallback)", async () => {
    expect((await build().fetch(reqOf("/demo", "POST"))).status).toBe(405);
  });
});
```

**Step 2: 실패 확인.**

**Step 3: 구현**
```ts
import type { Context, Hono, MiddlewareHandler } from "hono";
import type { DependencyContainer } from "tsyringe";
import {
  type CanActivate, getControllerPath, getGuards, getRoutes, type RouteDef,
} from "./decorators";
import { error } from "./responses";

const ALL = "ALL" as const;

function methodNotAllowed(): Response {
  return error("method_not_allowed", 405);
}

function joinPath(base: string, path: string): string {
  if (!path) return base || "/";
  return `${base}${path}`;
}

// biome-ignore lint: 컨트롤러 인스턴스
type ControllerInstance = object;

export const RouterFactory = {
  register(app: Hono, controllers: ControllerInstance[], container: DependencyContainer): void {
    const metas = controllers.map((instance) => {
      const ctor = (instance as { constructor: Function }).constructor;
      return {
        instance,
        base: getControllerPath(ctor),
        routes: getRoutes(ctor),
        guards: getGuards(ctor),
      };
    });

    // 1. 가드 미들웨어 (base + base/*)
    for (const m of metas) {
      for (const Guard of m.guards) {
        const guard = container.resolve(Guard) as CanActivate;
        const mw: MiddlewareHandler = (c, next) => guard.handle(c, next);
        app.use(m.base || "/", mw);
        app.use(`${m.base}/*`, mw);
      }
    }

    // 2. 정확(비-와일드카드) 라우트
    for (const m of metas) {
      for (const route of m.routes) {
        if (route.path.includes("*")) continue;
        const full = joinPath(m.base, route.path);
        bind(app, route, full, m.instance);
      }
    }

    // 3. 405 catch-all
    for (const m of metas) {
      const exact = m.routes.filter((r) => !r.path.includes("*"));
      if (m.base) {
        app.on(ALL, m.base, methodNotAllowed);
        app.on(ALL, `${m.base}/*`, methodNotAllowed);
      } else {
        for (const route of exact) {
          app.on(ALL, joinPath(m.base, route.path), methodNotAllowed);
        }
      }
    }

    // 4. 와일드카드 라우트
    for (const m of metas) {
      for (const route of m.routes) {
        if (!route.path.includes("*")) continue;
        bind(app, route, joinPath(m.base, route.path), m.instance);
      }
    }

    // 5. 전역 폴백
    app.on(ALL, "*", methodNotAllowed);
  },
};

function bind(app: Hono, route: RouteDef, full: string, instance: ControllerInstance): void {
  const handler = (c: Context) =>
    (instance as Record<string, (ctx: Context) => Response | Promise<Response>>)[route.handlerName](c);
  app[route.method](full, handler);
}
```
> 주의: Hono의 라우팅 우선순위는 **등록 순서**다. 위 1→5 단계가 그 순서를 결정적으로 보장한다. `app.on('ALL', ...)`로 모든 메서드를 잡는 405 폴백을 만든다. (Hono `app.all`도 동일하나 `app.on(method, path)` 형태를 사용해 의도를 명확히 한다.)

**Step 4: 통과 확인** — `bun test tests/unit/core/router-factory.test.ts` → 9 pass. 한 케이스라도 실패하면 등록 순서/매칭을 디버그(예: `app.on(ALL, base+'/*')` 위치, `joinPath` 빈 경로 처리).

**Step 5: 커밋**
```bash
git add src/core/http/router.factory.ts tests/unit/core/router-factory.test.ts
git commit -m "feat: 데코레이터 라우팅 RouterFactory 추가" -m "- 등록 순서 불변식(가드→정확→405 catch-all→와일드카드→전역 405)
- admin-prefix 405로 인증된 미지원 하위경로 보존"
```

---

## Task 10: 페이지 레포지토리 (`modules/pages/pages.repository.ts`)

`src/pageRepository.ts` 전체를 그대로 옮긴다(코드 변경 없음: `PageRepository`, `PageConflictError`, `PageNotFoundError`, 타입들, `sha256`/`mapMetadata`/`mapRendered`). DI 데코레이터 불필요 — 합성 루트에서 직접 생성한다. 더해 레포 계약 토큰/타입을 정의한다.

**Files:**
- Create: `src/modules/pages/pages.repository.ts` (= `src/pageRepository.ts` 내용)
- Create: `src/modules/pages/pages.contract.ts`
- Create: `tests/integration/pages.repository.test.ts` (= `tests/integration/pageRepository.test.ts`, import 변경)

**Step 3b: pages.contract.ts**
```ts
import type { PageRepository } from "./pages.repository";

export const PAGES_REPOSITORY = Symbol("PAGES_REPOSITORY");

export type PageRepositoryContract = Pick<
  PageRepository,
  "getCurrentPage" | "getCurrentMetadata" | "listRevisions" | "savePage" | "rollbackPage"
>;
```

Step 1 테스트 이식(통합) → Step 2 실패 → Step 3 복사 생성 + contract → Step 4 `ALLOW_TEST_DB_RESET=1 bun test tests/integration/pages.repository.test.ts` 통과 → Step 5 커밋
```bash
git add src/modules/pages/pages.repository.ts src/modules/pages/pages.contract.ts tests/integration/pages.repository.test.ts
git commit -m "feat: 페이지 레포지토리 모듈 및 계약 토큰 추가"
```

---

## Task 11: 페이지 서비스 (`modules/pages/pages.service.ts`) — F6

읽기에만 `withReadDeadline`(server.ts:238-248 이전), 쓰기는 직접 호출.

**Files:**
- Create: `src/modules/pages/pages.service.ts`
- Create: `tests/unit/modules/pages-service.test.ts`

**Step 1: 실패 테스트** (F6: 읽기 행→타임아웃 throw, 쓰기는 데드라인 없음·즉시 전달)
```ts
import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import type { AppConfig } from "../../../src/core/config/config";
import { ConfigService } from "../../../src/core/config/config.service";
import type { PageRepositoryContract } from "../../../src/modules/pages/pages.contract";
import { PagesService } from "../../../src/modules/pages/pages.service";

const cfg = (o: Partial<AppConfig> = {}): ConfigService =>
  new ConfigService({
    port: 8080, databaseUrl: "x", migrateDatabaseUrl: "x", adminTokenSha256: "a".repeat(64),
    htmlMaxBytes: 100, jsonMaxBytes: 700, dbConnectionTimeoutMs: 2000, dbStatementTimeoutMs: 3000,
    dbOperationTimeoutMs: 25, ...o,
  });

function repo(over: Partial<PageRepositoryContract> = {}): PageRepositoryContract {
  return {
    getCurrentPage: async () => null,
    getCurrentMetadata: async () => null,
    listRevisions: async () => [],
    savePage: async (i) => ({ path: i.path, revisionId: 1, contentSha256: "h", updatedAt: "t" }),
    rollbackPage: async (i) => ({ path: i.path, revisionId: i.revisionId, contentSha256: "h", updatedAt: "t" }),
    ...over,
  };
}

describe("PagesService", () => {
  test("read times out (deadline) -> rejects", async () => {
    const svc = new PagesService(repo({ getCurrentPage: () => new Promise(() => {}) }), cfg());
    await expect(svc.getCurrentPage("/x")).rejects.toThrow();
  });
  test("read returns value within deadline", async () => {
    const svc = new PagesService(repo({ getCurrentPage: async () => null }), cfg());
    expect(await svc.getCurrentPage("/x")).toBeNull();
  });
  test("write is NOT deadline-wrapped (hanging-read-deadline does not apply)", async () => {
    let called = false;
    const svc = new PagesService(repo({ savePage: async (i) => { called = true; return { path: i.path, revisionId: 9, contentSha256: "h", updatedAt: "t" }; } }), cfg());
    const out = await svc.savePage({ path: "/x", html: "h" });
    expect(called).toBe(true);
    expect(out.revisionId).toBe(9);
  });
});
```

**Step 3: 구현**
```ts
import "reflect-metadata";
import { inject, injectable } from "tsyringe";
import { ConfigService } from "../../core/config/config.service";
import { PAGES_REPOSITORY, type PageRepositoryContract } from "./pages.contract";
import type {
  PageMetadata, RenderedPage, RollbackPageInput, SavePageInput,
} from "./pages.repository";

@injectable()
export class PagesService {
  constructor(
    @inject(PAGES_REPOSITORY) private readonly pages: PageRepositoryContract,
    private readonly config: ConfigService,
  ) {}

  getCurrentPage(path: string): Promise<RenderedPage | null> {
    return this.withReadDeadline("getCurrentPage", this.pages.getCurrentPage(path));
  }
  getCurrentMetadata(path: string): Promise<PageMetadata | null> {
    return this.withReadDeadline("getCurrentMetadata", this.pages.getCurrentMetadata(path));
  }
  listRevisions(path: string): Promise<PageMetadata[]> {
    return this.withReadDeadline("listRevisions", this.pages.listRevisions(path));
  }
  savePage(input: SavePageInput): Promise<PageMetadata> {
    return this.pages.savePage(input);
  }
  rollbackPage(input: RollbackPageInput): Promise<PageMetadata> {
    return this.pages.rollbackPage(input);
  }

  private async withReadDeadline<T>(operation: string, work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${operation} timed out`)), this.config.dbOperationTimeoutMs);
      });
      return await Promise.race([work, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
```

Step 4 통과 → Step 5 커밋
```bash
git add src/modules/pages/pages.service.ts tests/unit/modules/pages-service.test.ts
git commit -m "feat: 페이지 서비스 추가 (읽기 전용 read deadline)"
```

---

## Task 12: 인증 가드 (`core/auth/auth.guard.ts`) — F1/F2

**Files:**
- Create: `src/core/auth/auth.guard.ts`
- Create: `tests/unit/core/auth-guard.test.ts`

**Step 1: 실패 테스트**
```ts
import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { Hono } from "hono";
import { ConfigService } from "../../../src/core/config/config.service";
import { AuthGuard } from "../../../src/core/auth/auth.guard";

const hash = createHash("sha256").update("secret").digest("hex");
const cfg = new ConfigService({
  port: 8080, databaseUrl: "x", migrateDatabaseUrl: "x", adminTokenSha256: hash,
  htmlMaxBytes: 100, jsonMaxBytes: 700, dbConnectionTimeoutMs: 2000, dbStatementTimeoutMs: 3000, dbOperationTimeoutMs: 25,
});

function app() {
  const guard = new AuthGuard(cfg);
  const a = new Hono();
  a.use("/p", (c, n) => guard.handle(c, n));
  a.get("/p", (c) => c.json({ ok: true }));
  return a;
}

describe("AuthGuard", () => {
  test("401 without bearer (native body + content-type)", async () => {
    const r = await app().fetch(new Request("https://x.test/p"));
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "unauthorized" });
    // native Response.json content-type (c.json 드리프트 방지 — byte-identical)
    expect(r.headers.get("content-type")).toBe(Response.json({}).headers.get("content-type"));
  });
  test("401 with wrong token", async () => {
    expect((await app().fetch(new Request("https://x.test/p", { headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
  });
  test("passes with correct token", async () => {
    const r = await app().fetch(new Request("https://x.test/p", { headers: { authorization: "Bearer secret" } }));
    expect(await r.json()).toEqual({ ok: true });
  });
});
```

**Step 3: 구현**
```ts
import "reflect-metadata";
import type { Context } from "hono";
import { injectable } from "tsyringe";
import { verifyBearerToken } from "./auth-token";
import { ConfigService } from "../config/config.service";
import type { CanActivate } from "../http/decorators";
import { error } from "../http/responses";

@injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  handle = async (c: Context, next: () => Promise<void>): Promise<Response | void> => {
    if (!(await verifyBearerToken(c.req.raw, this.config.adminTokenSha256))) {
      return error("unauthorized", 401);
    }
    await next();
  };
}
```

Step 4 통과 → Step 5 커밋
```bash
git add src/core/auth/auth.guard.ts tests/unit/core/auth-guard.test.ts
git commit -m "feat: 인증 가드(Hono 미들웨어) 추가"
```

---

## Task 13: 페이지 요청 검증 (`modules/pages/pages.validation.ts`)

`src/server.ts`의 `parsePath`(120-126), `asRecord`(128-131), `SHA256_HEX_RE`(164), `parseExpectedContentSha256`(211-217), `parseRequiredExpectedContentSha256`(219-221), `parsePositiveRevisionId`(223-228)를 옮긴다.

**Files:**
- Create: `src/modules/pages/pages.validation.ts`
- Create: `tests/unit/modules/pages-validation.test.ts`

**Step 3: 구현**
```ts
import { canonicalizePagePath } from "../../core/path/page-path";
import { BadRequestError } from "../../core/http/http-errors";

const SHA256_HEX_RE = /^[a-f0-9]{64}$/i;

export function parsePath(value: unknown): string {
  try {
    return canonicalizePagePath(value);
  } catch {
    throw new BadRequestError("invalid_path");
  }
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestError("invalid_body");
  return value as Record<string, unknown>;
}

export function parseExpectedContentSha256(value: unknown, required = false): string | undefined {
  if (value == null && !required) return undefined;
  if (typeof value !== "string" || !SHA256_HEX_RE.test(value)) {
    throw new BadRequestError("invalid_expected_content_sha256");
  }
  return value.toLowerCase();
}

export function parseRequiredExpectedContentSha256(value: unknown): string {
  return parseExpectedContentSha256(value, true) as string;
}

export function parsePositiveRevisionId(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new BadRequestError("invalid_revision_id");
  }
  return value as number;
}
```

**Step 1: 테스트** (각 에러 코드 검증)
```ts
import { describe, expect, test } from "bun:test";
import {
  asRecord, parseExpectedContentSha256, parsePath,
  parsePositiveRevisionId, parseRequiredExpectedContentSha256,
} from "../../../src/modules/pages/pages.validation";

describe("pages.validation", () => {
  test("parsePath rejects non-canonical -> invalid_path", () => {
    expect(() => parsePath("demo")).toThrow();
    try { parsePath("demo"); } catch (e: any) { expect(e.code).toBe("invalid_path"); }
    expect(parsePath("/demo")).toBe("/demo");
  });
  test("asRecord rejects arrays/null -> invalid_body", () => {
    for (const v of [null, [], "x", 1]) {
      try { asRecord(v); throw new Error("no throw"); } catch (e: any) { expect(e.code).toBe("invalid_body"); }
    }
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
  });
  test("revisionId must be positive integer", () => {
    for (const v of [0, -1, 1.5, "1", undefined]) {
      try { parsePositiveRevisionId(v); throw new Error("no throw"); } catch (e: any) { expect(e.code).toBe("invalid_revision_id"); }
    }
    expect(parsePositiveRevisionId(3)).toBe(3);
  });
  test("expectedContentSha256 optional vs required", () => {
    expect(parseExpectedContentSha256(undefined)).toBeUndefined();
    try { parseRequiredExpectedContentSha256(undefined); throw new Error("no throw"); } catch (e: any) { expect(e.code).toBe("invalid_expected_content_sha256"); }
    expect(parseExpectedContentSha256("A".repeat(64))).toBe("a".repeat(64));
    try { parseExpectedContentSha256("not-a-sha"); throw new Error("no throw"); } catch (e: any) { expect(e.code).toBe("invalid_expected_content_sha256"); }
  });
});
```

Step 2 실패 → Step 3 구현 → Step 4 통과 → Step 5 커밋
```bash
git add src/modules/pages/pages.validation.ts tests/unit/modules/pages-validation.test.ts
git commit -m "feat: 페이지 요청 검증 모듈 추가"
```

---

## Task 14: 관리자 컨트롤러 (`modules/pages/pages.admin.controller.ts`) — F3/F4/F5/F7

**Files:**
- Create: `src/modules/pages/pages.admin.controller.ts`
- (단위 동작은 Task 18의 `app.test.ts`에서 종합 검증)

**Step 1: 구현**
```ts
import "reflect-metadata";
import type { Context } from "hono";
import { injectable } from "tsyringe";
import { AuthGuard } from "../../core/auth/auth.guard";
import { readBoundedJson, byteLength } from "../../core/http/bounded-json";
import { RequestTooLargeError, BadRequestError } from "../../core/http/http-errors";
import { Controller, Get, Post, Put, UseGuard } from "../../core/http/decorators";
import { json, error } from "../../core/http/responses";
import { ConfigService } from "../../core/config/config.service";
import { PagesService } from "./pages.service";
import {
  asRecord, parseExpectedContentSha256, parsePath,
  parsePositiveRevisionId, parseRequiredExpectedContentSha256,
} from "./pages.validation";

@injectable()
@Controller("/api/pages")
@UseGuard(AuthGuard)
export class PagesAdminController {
  constructor(
    private readonly pages: PagesService,
    private readonly config: ConfigService,
  ) {}

  @Put("")
  async save(c: Context): Promise<Response> {
    const body = asRecord(await readBoundedJson(c.req.raw, this.config.jsonMaxBytes));
    const path = parsePath(body.path);
    const html = body.html;
    if (typeof html !== "string") throw new BadRequestError("invalid_body");
    if (byteLength(html) > this.config.htmlMaxBytes) throw new RequestTooLargeError();
    const expectedContentSha256 = parseExpectedContentSha256(body.expectedContentSha256, false);
    const saved = await this.pages.savePage({ path, html, expectedContentSha256 });
    return json(saved);
  }

  @Get("")
  async getMetadata(c: Context): Promise<Response> {
    const path = parsePath(c.req.query("path") ?? null);
    const metadata = await this.pages.getCurrentMetadata(path);
    return metadata ? json(metadata) : error("not_found", 404);
  }

  @Get("/revisions")
  async listRevisions(c: Context): Promise<Response> {
    const path = parsePath(c.req.query("path") ?? null);
    const revisions = await this.pages.listRevisions(path);
    return json({ revisions });
  }

  @Post("/rollback")
  async rollback(c: Context): Promise<Response> {
    const body = asRecord(await readBoundedJson(c.req.raw, this.config.jsonMaxBytes));
    const path = parsePath(body.path);
    const revisionId = parsePositiveRevisionId(body.revisionId);
    const expectedContentSha256 = parseRequiredExpectedContentSha256(body.expectedContentSha256);
    const rolledBack = await this.pages.rollbackPage({ path, revisionId, expectedContentSha256 });
    return json(rolledBack);
  }
}
```
> 검증·바디 읽기는 service 호출 **전에** 모두 수행 → 에러 시 레포 미접근(F4). `readBoundedJson` 사용으로 파싱 전 크기 차단(F3). htmlMaxBytes(F5). 에러는 throw → Task 17 ExceptionFilter가 매핑.

**Step 2: typecheck**
Run: `bun run typecheck` → 0 errors.

**Step 3: 커밋**
```bash
git add src/modules/pages/pages.admin.controller.ts
git commit -m "feat: 페이지 관리자 컨트롤러 추가"
```

---

## Task 15: 렌더 컨트롤러 (`modules/pages/page-render.controller.ts`) — F9

**Files:**
- Create: `src/modules/pages/page-render.controller.ts`

**Step 1: 구현**
```ts
import "reflect-metadata";
import type { Context } from "hono";
import { injectable } from "tsyringe";
import { Controller, Get } from "../../core/http/decorators";
import { error } from "../../core/http/responses";
import { canonicalizePagePath } from "../../core/path/page-path";
import { renderHeaders } from "../../core/render/render-headers";
import { PagesService } from "./pages.service";

@injectable()
@Controller("")
export class PageRenderController {
  constructor(private readonly pages: PagesService) {}

  @Get("*")
  async render(c: Context): Promise<Response> {
    let path: string;
    try {
      path = canonicalizePagePath(c.req.path);
    } catch {
      return error("not_found", 404);
    }
    const page = await this.pages.getCurrentPage(path);
    if (!page) return error("not_found", 404);
    return new Response(page.html, { status: 200, headers: renderHeaders() });
  }
}
```
> 레포 예외/행은 throw → ExceptionFilter가 503(F8). `c.req.path`는 pathname.

Step 2 typecheck → Step 3 커밋
```bash
git add src/modules/pages/page-render.controller.ts
git commit -m "feat: 페이지 렌더 컨트롤러 추가"
```

---

## Task 16: 헬스 컨트롤러 (`modules/health/health.controller.ts`)

**Files:**
- Create: `src/modules/health/health.controller.ts`

**Step 1: 구현**
```ts
import "reflect-metadata";
import type { Context } from "hono";
import { injectable } from "tsyringe";
import { Controller, Get } from "../../core/http/decorators";
import { json } from "../../core/http/responses";

@injectable()
@Controller("")
export class HealthController {
  @Get("/health")
  health(_c: Context): Response {
    return json({ ok: true });
  }
}
```
Step 2 typecheck → Step 3 커밋
```bash
git add src/modules/health/health.controller.ts
git commit -m "feat: 헬스 컨트롤러 추가"
```

---

## Task 17: 예외 필터 (`core/http/exception.filter.ts`) — F7/F8

`src/server.ts`의 `mapRouteError`(133-141), `stripHtml`(143-150), `repositoryFailure`(230-236) 로직을 Hono `onError`로 통합.

**Files:**
- Create: `src/core/http/exception.filter.ts`
- Create: `tests/unit/core/exception-filter.test.ts`

**Step 1: 실패 테스트**
```ts
import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { registerExceptionFilter } from "../../../src/core/http/exception.filter";
import { BadRequestError, RequestTooLargeError } from "../../../src/core/http/http-errors";
import { PageConflictError, PageNotFoundError } from "../../../src/modules/pages/pages.repository";

function appThrowing(err: unknown) {
  const a = new Hono();
  registerExceptionFilter(a);
  a.get("/x", () => { throw err; });
  return a;
}
const get = (a: Hono) => a.fetch(new Request("https://x.test/x"));

describe("exception filter", () => {
  test("RequestTooLargeError -> 413 payload_too_large", async () => {
    const r = await get(appThrowing(new RequestTooLargeError()));
    expect(r.status).toBe(413);
    expect(await r.json()).toEqual({ error: "payload_too_large" });
  });
  test("BadRequestError -> 400 with code", async () => {
    const r = await get(appThrowing(new BadRequestError("invalid_path")));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "invalid_path" });
  });
  test("PageConflictError with current -> 409 conflict + stripped metadata (no html)", async () => {
    const current = { path: "/d", revisionId: 2, contentSha256: "h", updatedAt: "t" };
    const r = await get(appThrowing(new PageConflictError("c", current as any)));
    expect(r.status).toBe(409);
    const body = await r.json();
    expect(body).toEqual({ error: "conflict", current });
    expect(body.current).not.toHaveProperty("html");
  });
  test("PageConflictError without current -> 409 conflict only", async () => {
    const r = await get(appThrowing(new PageConflictError("c")));
    expect(await r.json()).toEqual({ error: "conflict" });
  });
  test("PageNotFoundError -> 404 not_found", async () => {
    const r = await get(appThrowing(new PageNotFoundError("x")));
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "not_found" });
  });
  test("unknown error -> 503 service_unavailable", async () => {
    const r = await get(appThrowing(new Error("db down")));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "service_unavailable" });
  });
});
```

**Step 3: 구현**
```ts
import type { Hono } from "hono";
import { error } from "./responses";
import { BadRequestError, RequestTooLargeError } from "./http-errors";
import {
  PageConflictError, PageNotFoundError,
  type PageMetadata, type RenderedPage,
} from "../../modules/pages/pages.repository";

function stripHtml(page: PageMetadata | RenderedPage): PageMetadata {
  return {
    path: page.path,
    revisionId: page.revisionId,
    contentSha256: page.contentSha256,
    updatedAt: page.updatedAt,
  };
}

export function registerExceptionFilter(app: Hono): void {
  app.onError((err, c) => {
    if (err instanceof RequestTooLargeError) return error("payload_too_large", 413);
    if (err instanceof BadRequestError) return error(err.code, 400);
    if (err instanceof PageConflictError) {
      return error("conflict", 409, err.current ? { current: stripHtml(err.current) } : {});
    }
    if (err instanceof PageNotFoundError) return error("not_found", 404);
    console.error("repository failure", {
      operation: `${c.req.method} ${c.req.path}`,
      error: err instanceof Error ? err.message : String(err),
    });
    return error("service_unavailable", 503);
  });
}
```
> 주의: `error()`는 native `Response.json` 기반이라 구 `mapRouteError`/`repositoryFailure`와 byte-identical. `PageConflictError.current`는 이미 PageMetadata(무 html)지만 현행과 동일하게 stripHtml로 4필드만 직렬화(F7).

Step 4 통과 → Step 5 커밋
```bash
git add src/core/http/exception.filter.ts tests/unit/core/exception-filter.test.ts
git commit -m "feat: 전역 예외 필터(onError) 추가"
```

---

## Task 18: 모듈 합성 + createApp (`app.module.ts`) + 종합 단위 테스트

`createApp({config, pages})`를 합성 루트로 만들고, 기존 `tests/unit/server.test.ts`의 **모든 assertion**을 `tests/unit/app.test.ts`로 이식(F1–F10 종합).

**Files:**
- Create: `src/modules/pages/pages.module.ts`
- Create: `src/modules/health/health.module.ts`
- Create: `src/app.module.ts`
- Create: `tests/unit/app.test.ts`

**Step 3a: pages.module.ts** (NestJS 모듈 에뮬레이션 — 등록·컨트롤러 목록)
```ts
import type { DependencyContainer } from "tsyringe";
import { PageRenderController } from "./page-render.controller";
import { PagesAdminController } from "./pages.admin.controller";

export const PagesModule = {
  // 컨트롤러는 합성 루트에서 resolve. 등록할 추가 프로바이더가 없으면 no-op.
  register(_container: DependencyContainer): void {},
  controllers: [PagesAdminController, PageRenderController],
};
```

**Step 3b: health.module.ts**
```ts
import type { DependencyContainer } from "tsyringe";
import { HealthController } from "./health.controller";

export const HealthModule = {
  register(_container: DependencyContainer): void {},
  controllers: [HealthController],
};
```

**Step 3c: app.module.ts**
```ts
import "reflect-metadata";
import { Hono } from "hono";
import { container } from "tsyringe";
import type { AppConfig } from "./core/config/config";
import { ConfigService } from "./core/config/config.service";
import { registerExceptionFilter } from "./core/http/exception.filter";
import { RouterFactory } from "./core/http/router.factory";
import { HealthController } from "./modules/health/health.controller";
import { PageRenderController } from "./modules/pages/page-render.controller";
import { PagesAdminController } from "./modules/pages/pages.admin.controller";
import { PAGES_REPOSITORY, type PageRepositoryContract } from "./modules/pages/pages.contract";

export interface AppDeps {
  config: AppConfig;
  pages: PageRepositoryContract;
}

export function createApp(deps: AppDeps): Hono {
  const c = container.createChildContainer();
  c.registerInstance(ConfigService, new ConfigService(deps.config));
  c.registerInstance<PageRepositoryContract>(PAGES_REPOSITORY, deps.pages);

  const app = new Hono();
  registerExceptionFilter(app);

  // 컨트롤러 순서는 RouterFactory가 단계로 강제하므로 결과에 영향 없음(불변식).
  const controllers = [
    c.resolve(PagesAdminController),
    c.resolve(HealthController),
    c.resolve(PageRenderController),
  ];
  RouterFactory.register(app, controllers, c);
  return app;
}
```
> `createApp`는 `{config, pages}`를 받아 Hono 앱을 반환 — 기존 `createServer`의 후신. 반환 앱은 `.fetch`를 가지므로 테스트·`Bun.serve` 모두 호환.

**Step 1: `tests/unit/app.test.ts`** — `tests/unit/server.test.ts`의 모든 케이스를 이식하되 `createServer` → `createApp`로 교체. `FakePages`/`ThrowingPages`/`HangingPages`/`config`/`request` 헬퍼를 그대로 가져온다(import 경로: 타입은 `../../src/modules/pages/pages.repository`). **추가로 F10 신규 케이스도 포함**:
```ts
// 기존 server.test.ts의 모든 test를 이식 + 아래 추가:
test("authed unknown admin subpath returns 405", async () => {
  const server = createApp({ config, pages: new FakePages() });
  const r = await server.fetch(request("/api/pages/foo", { headers: { authorization: "Bearer secret" } }));
  expect(r.status).toBe(405);
});
test("unauthed unknown admin subpath returns 401", async () => {
  const server = createApp({ config, pages: new FakePages() });
  expect((await server.fetch(request("/api/pages/foo"))).status).toBe(401);
});
test("non-GET on render path returns 405", async () => {
  const server = createApp({ config, pages: new FakePages() });
  expect((await server.fetch(request("/demo", { method: "POST" }))).status).toBe(405);
});
test("non-GET on /health returns 405", async () => {
  const server = createApp({ config, pages: new FakePages() });
  expect((await server.fetch(request("/health", { method: "POST" }))).status).toBe(405);
});
test("GET /api/foo (reserved) returns 404 after auth-free render path", async () => {
  const server = createApp({ config, pages: new FakePages() });
  // /api/foo는 admin 경로가 아니므로 가드 없음 → 렌더 → 예약 → 404
  expect((await server.fetch(request("/api/foo"))).status).toBe(404);
});
```
> 이식 시 주의: 기존 `server.test.ts`의 `import { createServer } from "../../src/server"` → `import { createApp } from "../../src/app.module"`, 타입 import 경로를 `../../src/modules/pages/pages.repository`로 변경. `config` 객체는 그대로(AppConfig 형태). 모든 기존 assertion(상태코드·바디·`pages.calls`)을 보존한다.

**Step 2: 실패 확인** → **Step 4: 통과 확인**
Run: `bun test tests/unit/app.test.ts`
Expected: 기존 49개에 대응하는 케이스 + 신규 5개 모두 pass. 실패 시 해당 F제약을 디버그.

**Step 5: 전체 단위 + typecheck (신·구 동시 green = 패리티)**
Run: `bun run typecheck && bun run test:unit`
Expected: 0 errors. 기존 49 + 신규 전부 pass (구 server.test.ts 여전히 green = 안전망 유지).

**Step 6: 커밋**
```bash
git add src/modules/pages/pages.module.ts src/modules/health/health.module.ts src/app.module.ts tests/unit/app.test.ts
git commit -m "feat: 모듈 합성 createApp 및 종합 단위 테스트 추가"
```

---

## Task 19: 통합 라우트 테스트 이식 (`tests/integration/app.routes.test.ts`)

`tests/integration/serverRoutes.test.ts`의 **모든 케이스**(생성/렌더/업데이트/리비전/롤백, 에러·충돌, 빈 바디, 잘못된 롤백, 읽기 타임아웃 풀 비고갈, 쓰기 타임아웃 롤백)를 `createApp`로 이식.

**Files:**
- Create: `tests/integration/app.routes.test.ts`

**Step 1:** `serverRoutes.test.ts` 내용 복사 후 아래 import를 **모두** 새 경로로 리다이렉트(Task 20 삭제 후 dangling 방지 — 대상 모듈은 Task 6/10에서 이미 생성됨):
- `import { createServer } from "../../src/server"` → `import { createApp } from "../../src/app.module"`, 본문 `createServer(` → `createApp(`
- `import type { AppConfig } from "../../src/config"` → `"../../src/core/config/config"`
- `import { PageRepository } from "../../src/pageRepository"` → `"../../src/modules/pages/pages.repository"`
- `./helpers` import은 그대로(Task 7에서 helpers가 이미 새 db 경로 사용). `testConfig` 유지.

**Step 2: 실패 확인** (Postgres 필요)
```bash
docker compose -f docker-compose.test.yaml up -d
ALLOW_TEST_DB_RESET=1 bun test tests/integration/app.routes.test.ts
```
신규 파일이 없으면 실패 → 작성 후 통과.

**Step 3~4:** 작성 → `ALLOW_TEST_DB_RESET=1 bun test tests/integration/app.routes.test.ts` → 모든 케이스 pass.

**Step 5: 전체 통합(신·구 동시) green 확인**
Run: `ALLOW_TEST_DB_RESET=1 bun run test:integration`
Expected: 기존 16 + 신규 전부 pass.

**Step 6: 커밋**
```bash
git add tests/integration/app.routes.test.ts
git commit -m "test: createApp 기반 통합 라우트 테스트 이식"
```

---

## Task 19b: 구↔신 차등 계약 테스트 (크로스오버 전 필수 게이트) — byte-identical 증거

기존 assertion만으로는 Hono 스왑이 헤더/직렬화/메서드 매트릭스(HEAD/OPTIONS)를 바꿔도 통과할 수 있다. 구 `createServer`와 신 `createApp`에 **동일 요청 코퍼스**를 보내 status·원시 바디 바이트·**전체 헤더 맵(휘발성 제외)** 을 1:1 비교해 byte-identical을 직접 증명한다. **이 테스트가 green이어야만 Task 20에서 구 서버를 삭제한다.**

**Files:**
- Create: `tests/unit/contract-parity.test.ts`

**Step 1: 차등 테스트 작성** (구↔신 동일 동작 검증)
```ts
import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createServer } from "../../src/server"; // 구 (크로스오버 전까지 존재)
import { createApp } from "../../src/app.module"; // 신
import { PageConflictError as OldPageConflictError } from "../../src/pageRepository"; // 구 모듈 에러
import { PageConflictError as NewPageConflictError } from "../../src/modules/pages/pages.repository"; // 신 모듈 에러
import type {
  PageMetadata, RenderedPage, RollbackPageInput, SavePageInput,
} from "../../src/modules/pages/pages.repository";

const adminHash = createHash("sha256").update("secret").digest("hex");
const config = {
  port: 8080, databaseUrl: "postgres://test", migrateDatabaseUrl: "postgres://test",
  adminTokenSha256: adminHash, htmlMaxBytes: 100, jsonMaxBytes: 700,
  dbConnectionTimeoutMs: 2_000, dbStatementTimeoutMs: 3_000, dbOperationTimeoutMs: 25,
};

// 구 server.test.ts의 FakePages와 동일 (구 Pages·신 PageRepositoryContract 둘 다 구조적으로 만족)
class FakePages {
  current: RenderedPage | null = null;
  revisions: PageMetadata[] = [];
  async getCurrentPage(path: string) { return this.current?.path === path ? this.current : null; }
  async getCurrentMetadata(path: string) {
    const page = await this.getCurrentPage(path);
    if (!page) return null;
    const { html: _html, ...meta } = page;
    return meta;
  }
  async listRevisions() { return this.revisions; }
  async savePage(input: SavePageInput) {
    const meta = { path: input.path, revisionId: 1, contentSha256: createHash("sha256").update(input.html).digest("hex"), updatedAt: new Date(0).toISOString() };
    this.current = { ...meta, html: input.html }; this.revisions = [meta]; return meta;
  }
  async rollbackPage(_i: RollbackPageInput) { if (!this.revisions[0]) throw new Error("missing"); this.current = { ...this.revisions[0], html: "rb" }; return this.revisions[0]; }
}

const conflictCurrent: PageMetadata = {
  path: "/demo", revisionId: 2, contentSha256: "a".repeat(64), updatedAt: new Date(0).toISOString(),
};
// 충돌은 구·신이 각자 모듈의 PageConflictError를 instanceof로 판별하므로 앱별 전용 fake를 주입한다.
class OldConflictPages extends FakePages {
  override async savePage(): Promise<PageMetadata> { throw new OldPageConflictError("c", conflictCurrent); }
}
class NewConflictPages extends FakePages {
  override async savePage(): Promise<PageMetadata> { throw new NewPageConflictError("c", conflictCurrent); }
}

type Probe = {
  name: string;
  path: string;
  init?: RequestInit;
  seed?: (p: FakePages) => void;
  makeOld?: () => FakePages;
  makeNew?: () => FakePages;
};

const auth = { authorization: "Bearer secret" };
const jsonAuth = { ...auth, "content-type": "application/json" };
const seedCurrent = (p: FakePages) => {
  p.current = { path: "/demo", revisionId: 1, contentSha256: "h", updatedAt: new Date(0).toISOString(), html: "<h1>Hi</h1>" };
};
const seedRevisions = (p: FakePages) => {
  p.revisions = [{ path: "/demo", revisionId: 1, contentSha256: "a".repeat(64), updatedAt: new Date(0).toISOString() }];
};

const probes: Probe[] = [
  // --- 실패/라우팅 ---
  { name: "health GET", path: "/health" },
  { name: "health POST", path: "/health", init: { method: "POST" } },
  { name: "health OPTIONS", path: "/health", init: { method: "OPTIONS" } },
  { name: "health HEAD", path: "/health", init: { method: "HEAD" } },
  { name: "meta unauth", path: "/api/pages?path=/demo" },
  { name: "put unauth", path: "/api/pages", init: { method: "PUT", body: "{}" } },
  { name: "put invalid json", path: "/api/pages", init: { method: "PUT", headers: jsonAuth, body: "{" } },
  { name: "put missing body", path: "/api/pages", init: { method: "PUT", headers: jsonAuth } },
  { name: "put invalid path", path: "/api/pages", init: { method: "PUT", headers: jsonAuth, body: JSON.stringify({ path: "demo", html: "x" }) } },
  { name: "put oversized html", path: "/api/pages", init: { method: "PUT", headers: jsonAuth, body: JSON.stringify({ path: "/demo", html: "x".repeat(101) }) } },
  { name: "admin unknown subpath auth", path: "/api/pages/foo", init: { headers: auth } },
  { name: "admin unknown subpath unauth", path: "/api/pages/foo" },
  { name: "admin wrong method auth", path: "/api/pages", init: { method: "DELETE", headers: auth } },
  { name: "rollback bad body", path: "/api/pages/rollback", init: { method: "POST", headers: jsonAuth, body: JSON.stringify({ path: "/demo", revisionId: 0, expectedContentSha256: "a".repeat(64) }) } },
  // --- 성공 admin (인증 쓰기/읽기 API 바디·헤더 패리티) ---
  { name: "save new ok", path: "/api/pages", init: { method: "PUT", headers: jsonAuth, body: JSON.stringify({ path: "/demo", html: "<h1>v1</h1>" }) } },
  { name: "metadata ok", path: "/api/pages?path=/demo", init: { headers: auth }, seed: seedCurrent },
  { name: "revisions ok", path: "/api/pages/revisions?path=/demo", init: { headers: auth }, seed: seedRevisions },
  { name: "rollback ok", path: "/api/pages/rollback", init: { method: "POST", headers: jsonAuth, body: JSON.stringify({ path: "/demo", revisionId: 1, expectedContentSha256: "a".repeat(64) }) }, seed: seedRevisions },
  // --- 충돌 (409 conflict + current 직렬화) ---
  { name: "conflict save", path: "/api/pages", init: { method: "PUT", headers: jsonAuth, body: JSON.stringify({ path: "/demo", html: "x", expectedContentSha256: "b".repeat(64) }) }, makeOld: () => new OldConflictPages(), makeNew: () => new NewConflictPages() },
  // --- 렌더 ---
  { name: "render existing", path: "/demo", seed: seedCurrent },
  { name: "render missing", path: "/missing" },
  { name: "render POST", path: "/demo", init: { method: "POST" } },
  { name: "render invalid path", path: "/Bad_PATH" },
  { name: "reserved api GET", path: "/api/foo" },
  { name: "reserved api POST", path: "/api/foo", init: { method: "POST" } },
];

// 휘발성 헤더만 제외하고 전체 헤더 맵을 정규화 비교 → 예상치 못한 헤더 추가/누락/변경까지 차단.
// (신 응답은 native Response.json/Response이므로 구와 전체 헤더가 일치해야 한다.)
const VOLATILE = new Set(["date"]);
function headerMap(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of res.headers) {
    const key = k.toLowerCase();
    if (!VOLATILE.has(key)) out[key] = v;
  }
  return out;
}

describe("contract parity: old createServer vs new createApp", () => {
  for (const probe of probes) {
    test(probe.name, async () => {
      const build = (factory?: () => FakePages): FakePages => {
        if (factory) return factory();
        const p = new FakePages();
        probe.seed?.(p);
        return p;
      };
      const oldApp = createServer({ config, pages: build(probe.makeOld) });
      const newApp = createApp({ config, pages: build(probe.makeNew) });
      const url = `https://page.test${probe.path}`;
      const oldRes = await oldApp.fetch(new Request(url, probe.init));
      const newRes = await newApp.fetch(new Request(url, probe.init));
      expect(newRes.status).toBe(oldRes.status);
      expect(await newRes.text()).toBe(await oldRes.text());
      // 전체 헤더 맵 동치(휘발성 제외). 불일치 = 외부 관측 가능한 드리프트 → 신 코드를 구와 일치하도록 수정.
      expect(headerMap(newRes)).toEqual(headerMap(oldRes));
    });
  }
});
```

**Step 2: 실행** — `bun test tests/unit/contract-parity.test.ts`

**Step 3: 불일치 처리(있으면)**
- 모든 프로브가 status·바디·헤더에서 일치해야 한다. 불일치 발견 시 **신 코드를 구와 일치하도록 수정**(엄격 보존 — 구 동작이 정답):
  - JSON content-type 불일치 → `c.json` 잔존 여부 확인 후 `core/http/responses.ts`의 `json()`/`error()`로 교체(작업 규칙 참조).
  - HEAD/OPTIONS 불일치 → RouterFactory의 405/매칭 처리 점검(예: Hono가 GET 라우트에 HEAD를 자동 응답하면 구 405와 어긋남 → 해당 케이스를 405로 맞추도록 폴백 조정).
  - 헤더 추가/누락 → 렌더는 `renderHeaders()` 그대로, JSON은 native 헬퍼로 통일.
- 수정 후 재실행하여 전 프로브 green.

**Step 4: 전체 단위 green 확인** — `bun run typecheck && bun run test:unit` (구 server.test.ts 포함 전부 green).

**Step 5: 커밋**
```bash
git add tests/unit/contract-parity.test.ts
git commit -m "test: 구↔신 응답 차등 계약 테스트 추가"
```

---

## Task 20: 크로스오버 — 부트스트랩 전환 + 구 코드/구 테스트 제거 + 최종 검증

**전제(필수):** Task 19b 차등 계약 테스트가 green이어야 한다(구↔신 byte-identical 증명). 이 게이트가 통과되지 않은 채 구 서버를 삭제하지 말 것. 신·구가 모두 green인 지점에서 엔트리를 새 앱으로 전환하고 구 파일을 삭제한다.

**Files:**
- Create: `src/main.ts`
- Modify: `package.json` (scripts: `dev`/`start` 엔트리)
- Modify: `Dockerfile` (엔트리 참조)
- Modify: `scripts/container-smoke.sh` (`/readyz` → `/health` 2곳, 현 서비스 계약 일치 — 잠재 불일치 교정)
- Delete: `src/index.ts`, `src/server.ts`, `src/auth.ts`, `src/config.ts`, `src/db.ts`, `src/path.ts`, `src/renderHeaders.ts`, `src/pageRepository.ts`
- Delete: `tests/unit/server.test.ts`, `tests/unit/auth.test.ts`, `tests/unit/config.test.ts`, `tests/unit/db.test.ts`, `tests/unit/path.test.ts`, `tests/unit/renderHeaders.test.ts`, `tests/integration/serverRoutes.test.ts`, `tests/integration/pageRepository.test.ts`, `tests/unit/contract-parity.test.ts` (일회성 크로스오버 게이트)

**Step 1: `src/main.ts` 작성** (= 구 `src/index.ts` 동작, 새 모듈 사용)
```ts
import "reflect-metadata";
import { loadConfig } from "./core/config/config";
import { createPool, migrate } from "./core/database/db";
import { PageRepository } from "./modules/pages/pages.repository";
import { createApp } from "./app.module";

const config = loadConfig();
const dbTimeouts = {
  connectionTimeoutMs: config.dbConnectionTimeoutMs,
  statementTimeoutMs: config.dbStatementTimeoutMs,
};
const runtimePool = createPool(config.databaseUrl, dbTimeouts);
const migrationPool = createPool(config.migrateDatabaseUrl, dbTimeouts);

await migrate(migrationPool, config.databaseUrl);
await migrationPool.end();

const pages = new PageRepository(runtimePool);
const app = createApp({ config, pages });

Bun.serve({
  port: config.port,
  fetch: app.fetch,
});

console.log(`page listening on :${config.port}`);
```

**Step 2: package.json scripts 갱신**
- `"dev": "bun --watch src/main.ts"`
- `"start": "bun src/main.ts"`
(나머지 scripts 유지. `test`/`test:unit`/`test:integration`/`typecheck` 등은 그대로 — 디렉터리 단위 실행이므로 신규 테스트 자동 포함.)

**Step 3: Dockerfile 엔트리 참조 갱신**
Run: `grep -n "src/index.ts" Dockerfile` 로 확인 후, 있으면 `src/main.ts`로 변경. (CMD/ENTRYPOINT가 `bun src/index.ts` 형태면 `bun src/main.ts`로.)

**Step 4: 구 소스/구 테스트 삭제**
```bash
git rm src/index.ts src/server.ts src/auth.ts src/config.ts src/db.ts src/path.ts src/renderHeaders.ts src/pageRepository.ts
git rm tests/unit/server.test.ts tests/unit/auth.test.ts tests/unit/config.test.ts tests/unit/db.test.ts tests/unit/path.test.ts tests/unit/renderHeaders.test.ts
git rm tests/integration/serverRoutes.test.ts tests/integration/pageRepository.test.ts
# 차등 테스트는 구 createServer를 import하므로 크로스오버와 함께 제거(일회성 게이트, 역할 종료)
git rm tests/unit/contract-parity.test.ts
```

**Step 5: 잔존 참조 점검 (포괄적)**
Run:
```bash
# 레거시 최상위 src 파일 import 잔존 검사 (server/index/config/db/auth/path/renderHeaders/pageRepository)
grep -rEn 'from "(\.\./)+src/(server|index|config|db|auth|path|renderHeaders|pageRepository)"' src tests \
  && echo "STALE FOUND ↑ — 새 경로(core/*, modules/*, app.module)로 수정" || echo "OK: no stale legacy src imports"
# 엔트리 참조 검사
grep -rn "src/index\|src/server" Dockerfile package.json scripts 2>/dev/null \
  && echo "STALE ENTRY ↑ — src/main 으로 수정" || echo "OK: no stale entry refs"
```
Expected: 두 검사 모두 `OK: no stale ...`. 잡히면 새 경로로 수정 후 재실행. (helpers.ts는 Task 7에서 이미 새 db 경로로 리다이렉트됨.)

**Step 6: 최종 전체 검증**
```bash
bun run typecheck
bun run test:unit
docker compose -f docker-compose.test.yaml up -d
ALLOW_TEST_DB_RESET=1 bun run test:integration
```
Expected: typecheck 0 errors. unit: 신규 전부 pass(구 삭제됨). integration: 신규 전부 pass. **단위 테스트 수가 기존 49개 동작 커버리지를 모두 포함하는지** 커버리지 패리티 매핑 표로 대조 확인.

**Step 7: 로컬 기동 스모크 (하드 게이트)** — 실제 `bun src/main.ts` **새 프로세스**가 기동·서빙되는지 검증(스테일 서버 오탐 방지: 빈 포트 + PID liveness + trap)
```bash
docker compose -f docker-compose.test.yaml up -d
export ADMIN_TOKEN="local-admin-token"
export ADMIN_TOKEN_SHA256="$(printf '%s' "$ADMIN_TOKEN" | bun scripts/hash-token.ts)"
export DATABASE_URL="postgres://page_runtime:runtime@localhost:15432/page_test"
export MIGRATE_DATABASE_URL="postgres://page_migrator:migrator@localhost:15432/page_test"
# 충돌 없는 포트 확보(스테일 서버에 붙어 오탐 나는 것 방지)
export PORT=8799
if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then echo "PORT $PORT 사용 중 — 다른 포트로 변경"; exit 1; fi
bun src/main.ts & SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT
# 새 프로세스가 살아있을 때만 health 통과로 인정
for i in $(seq 1 20); do
  kill -0 "$SERVER_PID" 2>/dev/null || { echo "FAIL: src/main.ts 프로세스가 부팅 중 종료됨"; exit 1; }
  curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break
  sleep 0.5
done
kill -0 "$SERVER_PID" 2>/dev/null || { echo "FAIL: 프로세스 비정상 종료"; exit 1; }
curl -fsS "http://127.0.0.1:$PORT/health" | grep -q '"ok":true'
BASE_URL="http://127.0.0.1:$PORT" ADMIN_TOKEN="$ADMIN_TOKEN" bash scripts/smoke.sh
kill "$SERVER_PID" 2>/dev/null || true; trap - EXIT
```
Expected: 새 프로세스가 살아있는 상태에서 `/health`가 `{"ok":true}`, `smoke.sh`가 `smoke ok`. 프로세스 조기 종료/포트 점유 시 즉시 FAIL → 엔트리/serve 바인딩 수정 후 재실행.

**Step 8: 컨테이너 스모크 (docker 가용 시 필수)** — 워크트리에서 **새 이미지 빌드** 후 Dockerfile CMD/엔트리 검증

먼저 `scripts/container-smoke.sh`를 현 서비스 계약에 맞게 교정한다(이 서비스엔 `/readyz`가 없고 `/health`만 있음 — 기존 스크립트의 잠재 불일치 수정, 변경은 커밋 대상):
- `scripts/container-smoke.sh`의 `/readyz` 2곳(대기 루프 + 단정 `curl`)을 `/health`로 변경.

그 후 **반드시 현재 워크트리로 이미지를 빌드**(스테일 이미지 검증 방지)하고 실행:
```bash
docker compose -f docker-compose.test.yaml up -d
if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
  docker build -t page:local .                       # 워크트리 새 이미지 (필수)
  IMAGE=page:local bash scripts/container-smoke.sh   # 실패 = 게이트 실패 (스킵·우회 불가)
else
  echo "BLOCKER: docker 미가용 — 컨테이너 스모크 미실행. 머지 전 Docker 가능 환경/CI에서 반드시 통과시킬 것(미검증 상태 머지 금지)."
  exit 1
fi
```
Expected: docker 가용 환경에서는 갓 빌드한 `page:local`이 기동되고 `/health` 준비 후 `bun run smoke`가 통과(**스킵 불가**). docker 미가용이면 BLOCKER로 중단 — 이 게이트를 통과(또는 CI에서 통과)하기 전에는 크로스오버 커밋/머지 금지. (현 개발 환경은 docker 가용이므로 실행 필수.)

**Step 9: 커밋**
```bash
git add -A
git commit -m "refactor: 엔트리를 Hono 합성 앱으로 전환하고 구 모듈 제거" -m "- src/main.ts 부트스트랩, package.json/Dockerfile 엔트리 갱신
- 구 server/index 및 동작이 이식된 구 모듈·구 테스트 삭제
- 로컬 기동·컨테이너 스모크로 런타임 검증"
```

---

## 완료 기준 (Definition of Done)

- `bun run typecheck` 0 errors.
- `bun run test:unit` 전부 pass (F1–F10 + 신규 405 케이스 + DI/RouterFactory/필터/서비스 단위).
- `ALLOW_TEST_DB_RESET=1 bun run test:integration` 전부 pass.
- **크로스오버 전** `tests/unit/contract-parity.test.ts`(구↔신 status·바디·헤더 차등)가 전 프로브 green.
- **로컬 기동 스모크**(`bun src/main.ts` + `/health` + `scripts/smoke.sh`) 통과, **컨테이너 스모크**(`scripts/container-smoke.sh`) 통과(docker 미가용 시 명시적 로그).
- 커버리지 패리티 매핑 표의 모든 행이 신규 테스트로 커버됨.
- `src/`에 구 `server.ts`/`index.ts` 등 구 파일 없음, 구 테스트 없음, 구 경로 참조 없음.
- 외부 HTTP 계약 byte-identical(F1–F10 보존), 엔트리는 `src/main.ts`.

---

## Adversarial review dispositions (감사 기록 — 사후 기록, 재리뷰 대상 아님)

codex 적대적 리뷰 4패스(working-tree). 모든 패스 `ok:true`/`planInDiff:true`. 설계(Hono/DI/RouterFactory/strangler/native 응답)는 Pass 1 이후 무결점이며, 발견은 전부 검증 게이트 경화에 한정. 3패스 캡 도달 후 사용자가 Pass 4 검증을 승인했고, Pass 4의 2건(게이트 경화 nit)을 반영한 뒤 사용자가 확정을 승인함(수확 체감 구간 판단).

| 패스 | 발견 | 심각도 | 판정 | 반영 |
|---|---|---|---|---|
| 1 | byte-identical 계약 미검증 | high | 수용 | Task 19b 차등 테스트 + `core/http/responses.ts`(native) 도입, 컨트롤러/필터/405를 native 헬퍼로 |
| 1 | 엔트리 런타임 미검증 | medium | 수용 | Task 20 로컬 기동 스모크 + 컨테이너 스모크 필수화 |
| 2 | 차등 게이트가 성공 admin 응답 누락 | high | 수용 | corpus에 성공 save/meta/revisions/rollback + conflict(앱별 에러 클래스 fake) 추가 |
| 2 | 컨테이너 스모크가 새 이미지 미검증 | high | 수용 | `docker build` 후 실행, `container-smoke.sh` `/readyz`→`/health` 교정 |
| 3 | Guard 타입이 DI 주입 AuthGuard 거부 | high | 수용 | `GuardClass`를 `new(...args:any[])`로(NestJS Type 패턴) |
| 3 | AuthGuard가 `c.json` 사용(규칙 위반) | medium | 수용 | `error("unauthorized",401)`로 교체 + 테스트에 body·content-type 단정 |
| 3 | 이식 테스트의 구 `../../src/config`·`../../src/db` import 잔존 | medium | 수용 | Task 19 import 리다이렉트 명시 + Task 7 helpers.ts 리다이렉트 + Task 20 포괄 stale grep |
| 4 | 런타임 스모크가 스테일 프로세스/이미지 통과 가능 | high | 수용 | trap·빈 포트 확인·`kill -0` liveness, 컨테이너 스모크 스킵 불가(미가용 시 BLOCKER) |
| 4 | 차등 게이트가 전체 헤더 미비교 | medium | 수용 | 전체 헤더 맵 비교(휘발성 `date`만 제외) |

**기각: 없음.** 미해결 high: 없음.
**최종 패스(Pass 4) verdict:** `needs-attention` — `summary: "No-ship: the plan's final gates can still let an unverified runtime/container entrypoint and incomplete HTTP contract proof through."` (해당 2건은 본 패스에서 수용·반영됨. 확정은 캡+승인 패스 이후 사용자 결정에 따름 — `approve` verdict가 아니라 사용자 승인으로 마감.)

---

## Execution directives
- **Skill:** implement via `executing-plans` in a **separate session, in this worktree** (`.worktrees/hono-refactor`, branch `refactor/hono-nestjs`).
- **Run continuously:** do NOT stop between batches for routine review. Stop ONLY on a genuine blocker — missing dependency, a verification that keeps failing, an unclear/contradictory instruction, or a critical plan gap (executing-plans' own "When to Stop and Ask"). Otherwise proceed through every batch to completion.
  - **특히 Task 0의 DI 스파이크가 실패하면 STOP** — 설계 리스크 #1(데코레이터 메타데이터)이 현실화된 것이므로 사용자에게 보고하고 DI 방식 재논의.
  - **Task 19b 차등 게이트, Task 20 로컬/컨테이너 스모크가 실패하면 STOP 아님 — 신 코드를 구와 일치하도록 수정 후 재실행**(byte-identical이 정답). 단, 반복 실패로 막히면 STOP.
- **Commits — apply these rules directly; do NOT invoke `Skill(commit)`** (its interactive confirmation would break continuous execution):
  - **Language:** commit message in **Korean**. **No AI markers** — never include `🤖 Generated with`, `Co-Authored-By: Claude`, or similar.
  - **Format:** `<type>(<scope>): 한국어 설명` (optional `- 상세` body lines below). 본 저장소 기존 커밋은 scope 없이 `type: 설명` 형태이므로 그에 맞춰도 됨.
  - **Type — use ONLY these:** `feat` (새 기능), `fix` (버그 수정), `refactor` (리팩토링/성능), `docs` (문서), `style` (포맷팅), `test` (테스트), `chore` (빌드/설정). `perf`/`build`/`ci` 등 금지.
  - **Grouping (priority order):** ① 같은 기능/모듈 디렉터리 함께; ② 목적별 분리(refactor vs fix vs feature); ③ 서로 import/참조하는 파일은 함께; ④ 변경 유형별 분리 — 설정(`package.json`/`tsconfig`…), 테스트, 문서, 독립 style/CSS는 각각 자기 커밋.
  - **Judgment:** 같은 디렉터리 + 같은 목적 → 한 커밋; 다른 파일 없이는 의미 없는 변경 → 같은 커밋; 독립적으로 설명 가능한 변경 → 자기 커밋. (각 플랜 태스크에 제시된 커밋 명령을 그대로 사용.)
  - **Where:** 각 플랜 `Commit` 스텝에서, 현재 feature 브랜치 worktree(`refactor/hono-nestjs`)에 직접 커밋(이미 `main`이 아님 — 새 브랜치 불필요).
- **Baseline 재확인:** 실행 시작 전 `bun run typecheck && bun run test:unit` + (Postgres 기동 후) `ALLOW_TEST_DB_RESET=1 bun run test:integration`가 green인지 확인(현재 65 테스트 green).
