#!/bin/sh
# ============================================================
# Click-Deploy — Docker Entrypoint
# ============================================================
# Starts the Next.js server.
# Database migrations should be run externally:
#   docker exec click-deploy-app npx drizzle-kit push
# ============================================================

set -e

echo "⚡ Click-Deploy starting..."
echo "→ Starting web server on port ${PORT:-3000}..."
exec node apps/web/server.js
