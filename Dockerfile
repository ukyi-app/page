FROM oven/bun:1.4.3-alpine@sha256:629e17411f1f129dbec3af78d5af9c9f2a937435c80349437206c6b0b7422373 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# 관리 SPA(web/)를 single-file로 빌드 → /web/dist/index.html. 런타임이 /admin에서 서빙한다.
# ⚠️ BUILDPLATFORM 고정은 필수다. 산출물이 정적 자산이라 아키텍처와 무관한데, 이걸 빼면 이 스테이지가
#   타깃마다 한 번씩 돌고 amd64 leg는 QEMU 에뮬레이션을 탄다 — 거기서 bun 1.4.0은 RSS 24MB 시점에
#   JSC MemoryExhaustion으로 즉사한다(BUN_JSC_useJIT=0·forceRAMSize 둘 다 무효, 라이브에서 확인).
#   호스트(arm64 네이티브)에서 한 번만 빌드하고 dist를 양쪽에 복사하는 것이 회피이자 고속화다.
FROM --platform=$BUILDPLATFORM oven/bun:1.4.3-alpine@sha256:629e17411f1f129dbec3af78d5af9c9f2a937435c80349437206c6b0b7422373 AS web
WORKDIR /web
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY web/ ./
RUN bun run build

FROM oven/bun:1.4.3-alpine@sha256:629e17411f1f129dbec3af78d5af9c9f2a937435c80349437206c6b0b7422373 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
COPY --from=web /web/dist ./web/dist
USER bun
EXPOSE 8080
CMD ["bun", "src/main.ts"]
