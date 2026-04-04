# ============================================================
# Click-Deploy — Production Dockerfile
# ============================================================
# Multi-stage build for the Click-Deploy PaaS portal.
# Based on Next.js standalone output for minimal image size.
#
# Build:  docker build -t click-deploy .
# Run:    docker compose up -d
# ============================================================

# ── Stage 1: Dependencies ────────────────────────────────────
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Enable corepack for pnpm
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# Copy workspace configs
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/api/package.json ./packages/api/
COPY packages/database/package.json ./packages/database/
COPY packages/docker/package.json ./packages/docker/
COPY packages/shared/package.json ./packages/shared/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# ── Stage 2: Build ───────────────────────────────────────────
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# Install turbo globally (monorepo build orchestrator)
RUN npm install -g turbo

# Copy deps from previous stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/api/node_modules ./packages/api/node_modules
COPY --from=deps /app/packages/database/node_modules ./packages/database/node_modules
COPY --from=deps /app/packages/docker/node_modules ./packages/docker/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules

# Copy all source
COPY . .

# Build environment variables (these are baked into the build)
# Runtime env vars override these via docker-compose
ENV NEXT_TELEMETRY_DISABLED=1

# Capture commit SHA for version display
ARG GIT_COMMIT_SHA=unknown
ENV GIT_COMMIT_SHA=${GIT_COMMIT_SHA}

# Build the monorepo (NODE_ENV=production set AFTER build so devDeps are usable)
RUN pnpm build

ENV NODE_ENV=production

# ── Stage 3: DB Migrator (used once at startup) ──────────────
FROM builder AS migrator
# This stage contains all deps and is used by docker-compose to run migrations

# ── Stage 4: Production Runner ───────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Don't run as root
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy standalone output
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

# Copy package.json for version reads
COPY --from=builder /app/package.json ./package.json

# Pass commit SHA to runtime
ARG GIT_COMMIT_SHA=unknown
ENV GIT_COMMIT_SHA=${GIT_COMMIT_SHA}

# Copy entrypoint script
COPY --from=builder --chown=nextjs:nodejs /app/docker-entrypoint.sh ./docker-entrypoint.sh

# Set correct permissions
RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Startup: run database migrations then start the server
ENTRYPOINT ["./docker-entrypoint.sh"]
