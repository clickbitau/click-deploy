# syntax=docker/dockerfile:1
# ============================================================
# Click-Deploy — Production Dockerfile
# ============================================================
# Multi-stage build for the Click-Deploy PaaS portal.
# Based on Next.js standalone output for minimal image size.
# Optimized with BuildKit cache mounts for fast rebuilds.
#
# Build:  DOCKER_BUILDKIT=1 docker build -t click-deploy .
# Run:    docker compose up -d
# ============================================================

# ── Stage 1: Dependencies ────────────────────────────────────
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app

# Enable corepack for pnpm
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# Copy workspace configs (these layers are cached if lockfile is unchanged)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/api/package.json ./packages/api/
COPY packages/database/package.json ./packages/database/
COPY packages/docker/package.json ./packages/docker/
COPY packages/shared/package.json ./packages/shared/

# Install all dependencies (cache pnpm store across builds)
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

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
# packages/shared has zero deps — node_modules may not exist
RUN mkdir -p ./packages/shared/node_modules
COPY --from=deps /app/packages/shared/node_module[s] ./packages/shared/node_modules/

# Copy all source
COPY . .

# Build environment variables (these are baked into the build)
# Runtime env vars override these via docker-compose
ENV NEXT_TELEMETRY_DISABLED=1

# Supabase client vars must be available at build time (NEXT_PUBLIC_ prefix)
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}

# Capture commit SHA for version display
ARG GIT_COMMIT_SHA=unknown
ENV GIT_COMMIT_SHA=${GIT_COMMIT_SHA}

# Next.js 16 requires .env to exist at build time (stats the file).
# .dockerignore excludes .env* — create empty placeholders for build.
# Runtime env vars are injected via Swarm/Compose at container start.
RUN rm -f /app/apps/web/.env 2>/dev/null; touch /app/.env /app/apps/web/.env

# Build the monorepo with turbo cache mount for incremental rebuilds
# NODE_ENV=production set AFTER build so devDeps are usable
RUN --mount=type=cache,id=turbo-cache,target=/app/.turbo \
    pnpm build

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

# Install ws for WebSocket support in production
RUN npm install --no-save ws ssh2

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
