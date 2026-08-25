# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# homelab static 계약: Vite 산출물(dist)을 /public에 넣고 SWS가 /health + SPA fallback을 제공한다.

FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY index.html vite.config.ts ./
COPY public ./public
COPY src ./src
RUN pnpm build

FROM ghcr.io/static-web-server/static-web-server:2@sha256:2c1a7c3e0feaea5859307403b74e1c575f3ec1499094fc077344173d11abaae2
COPY --from=builder --chown=65532:65532 /app/dist /public
