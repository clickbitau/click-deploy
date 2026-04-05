#!/bin/bash
# ──────────────────────────────────────────────────────
# Click-Deploy: Node Registry Verification Script
# Run on any swarm node to verify registry connectivity.
# Usage: bash verify-registry.sh <manager_tailscale_ip>
# Example: bash verify-registry.sh 100.85.15.5
# ──────────────────────────────────────────────────────
set -euo pipefail

REGISTRY="${1:-100.85.15.5}:5000"
PASS=0
FAIL=0
WARN=0

log_pass() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
log_fail() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }
log_warn() { echo "  ⚠️  $1"; WARN=$((WARN + 1)); }

echo "╔══════════════════════════════════════════╗"
echo "║  Click-Deploy Registry Verification      ║"
echo "║  Target: ${REGISTRY}                     ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── 1. Docker daemon.json check ──
echo "── Step 1: Docker Daemon Configuration ──"
if [ -f /etc/docker/daemon.json ]; then
  if grep -q "${REGISTRY}" /etc/docker/daemon.json; then
    log_pass "daemon.json contains insecure-registry: ${REGISTRY}"
  else
    log_fail "daemon.json exists but does NOT contain ${REGISTRY}"
    echo "       Fix: Add '${REGISTRY}' to insecure-registries in /etc/docker/daemon.json"
  fi
else
  log_fail "/etc/docker/daemon.json does not exist"
  echo "       Fix: echo '{\"insecure-registries\":[\"${REGISTRY}\"]}' > /etc/docker/daemon.json && systemctl restart docker"
fi
echo ""

# ── 2. HTTP connectivity ──
echo "── Step 2: HTTP Connectivity ──"
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "http://${REGISTRY}/v2/" 2>/dev/null || echo "000")
if [ "$HTTP_STATUS" = "200" ]; then
  log_pass "Registry API reachable (HTTP 200)"
else
  log_fail "Registry API unreachable (HTTP ${HTTP_STATUS})"
  echo "       Fix: Verify Tailscale connectivity — 'ping ${REGISTRY%%:*}'"
fi

CATALOG=$(curl -s --connect-timeout 5 "http://${REGISTRY}/v2/_catalog" 2>/dev/null || echo "UNREACHABLE")
if echo "$CATALOG" | grep -q '"repositories"'; then
  log_pass "Catalog endpoint responds: ${CATALOG}"
else
  log_fail "Catalog endpoint failed: ${CATALOG}"
fi
echo ""

# ── 3. Docker pull test (non-destructive) ──
echo "── Step 3: Docker Pull Test ──"
# Try to pull a non-existent tag. Expected: 'not found' error (proves registry is reachable).
# HTTPS mismatch or timeout = real failure.
PULL_OUTPUT=$(docker pull "${REGISTRY}/click-deploy-verify-test:nonexistent" 2>&1 || true)
if echo "$PULL_OUTPUT" | grep -qi "manifest.*unknown\|not found\|tag.*not"; then
  log_pass "Docker daemon can communicate with registry (got 'not found' — expected)"
elif echo "$PULL_OUTPUT" | grep -qi "http:.*https\|server gave HTTP"; then
  log_fail "Docker daemon tried HTTPS — insecure-registries not configured"
  echo "       Fix: Add ${REGISTRY} to /etc/docker/daemon.json insecure-registries"
elif echo "$PULL_OUTPUT" | grep -qi "timeout\|connection refused\|no route"; then
  log_fail "Network error: ${PULL_OUTPUT}"
else
  log_warn "Unexpected response: ${PULL_OUTPUT}"
fi
echo ""

# ── 4. Tailscale connectivity ──
echo "── Step 4: Tailscale Status ──"
if command -v tailscale &>/dev/null; then
  TS_IP=$(tailscale ip -4 2>/dev/null || echo "N/A")
  TS_STATUS=$(tailscale status --json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('BackendState','unknown'))" 2>/dev/null || echo "unknown")
  if [ "$TS_STATUS" = "Running" ]; then
    log_pass "Tailscale running, local IP: ${TS_IP}"
  else
    log_warn "Tailscale status: ${TS_STATUS}"
  fi
else
  log_warn "Tailscale CLI not installed"
fi
echo ""

# ── Summary ──
echo "════════════════════════════════════════════"
echo "  Results: ${PASS} passed, ${FAIL} failed, ${WARN} warnings"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ This node is READY to pull from the registry."
else
  echo "  ❌ This node has ${FAIL} issue(s) that must be fixed."
fi
echo "════════════════════════════════════════════"
exit $FAIL
