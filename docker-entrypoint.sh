#!/bin/sh
# ============================================================
# Click-Deploy — Docker Entrypoint
# ============================================================
# Starts the custom server with WebSocket support.
# Falls back to the default Next.js server if ws module missing.
# ============================================================

set -e

echo "⚡ Click-Deploy starting..."
echo "→ Starting web server on port ${PORT:-3000}..."

# Use the WebSocket server if ws module is available
if node -e "require('ws')" 2>/dev/null; then
  exec node server.ws.js
else
  echo "⚠ ws module not found, falling back to default server"
  exec node apps/web/server.js
fi
