FROM oven/bun:1.3.10-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# 관리 SPA(web/)를 single-file로 빌드 → /web/dist/index.html. 런타임이 /admin에서 서빙한다.
FROM oven/bun:1.3.10-alpine AS web
WORKDIR /web
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY web/ ./
RUN bun run build

FROM oven/bun:1.3.10-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
COPY --from=web /web/dist ./web/dist
USER bun
EXPOSE 8080
CMD ["bun", "src/main.ts"]
