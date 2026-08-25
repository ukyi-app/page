# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# homelab worker 계약: HTTP route/probe 없음. 장기 실행 프로세스만 준비한다.

FROM oven/bun:1@sha256:5ff609364c049b54eb0ff560ec96319729a972078ef2c755d758f0c6ef89c2d6 AS builder
WORKDIR /app
COPY package.json ./
COPY src ./src
RUN bun run build

FROM oven/bun:1-distroless@sha256:a8919d4a092a234f7184ac6d3960a2d860fea73e034709e1752a7d0de09913f8 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
USER 65532:65532
ENTRYPOINT ["bun", "/app/dist/index.js"]
