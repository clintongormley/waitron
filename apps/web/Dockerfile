# ── Stage 1: deps ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/

RUN pnpm install --frozen-lockfile --filter @waitron/web --filter @waitron/shared

# ── Stage 2: build ────────────────────────────────────────────────────────────
FROM deps AS builder
WORKDIR /app

COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

WORKDIR /app/apps/web
RUN pnpm build

# ── Stage 3: runtime ─────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
RUN apk add --no-cache dumb-init
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000

COPY --from=builder /app/apps/web/public ./public
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./.next/static

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
