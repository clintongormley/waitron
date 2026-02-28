# ── Stage 1: deps ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# Copy workspace manifests (pnpm needs all package.json files for hoisting)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/

RUN pnpm install --frozen-lockfile --filter @waitron/api --filter @waitron/db --filter @waitron/shared

# ── Stage 2: build ────────────────────────────────────────────────────────────
FROM deps AS builder
WORKDIR /app

# Copy source
COPY packages/shared ./packages/shared
COPY packages/db ./packages/db
COPY apps/api ./apps/api

WORKDIR /app/apps/api
RUN pnpm build

# ── Stage 3: runtime ─────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
RUN apk add --no-cache dumb-init
WORKDIR /app

# Copy only the compiled bundle + node_modules (externalised)
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
# Copy i18n assets (not bundled by webpack)
COPY --from=builder /app/apps/api/src/i18n ./dist/i18n

ENV NODE_ENV=production
EXPOSE 3001

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
