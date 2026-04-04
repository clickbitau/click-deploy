# Click-Deploy — Platform Status & Roadmap

> Last updated: 2026-04-04

---

## ✅ Completed

### Infrastructure
- [x] **Multi-node Docker Swarm cluster** — `manager-01` (Proxmox LAN), `sydney` (remote manager), `worker-01` (build node)
- [x] **Docker Registry** — Running on `manager-01:5000` with `mode=host` publish for cross-node accessibility
- [x] **Cloudflare Tunnel** — `deploy.clickbit.com.au` routes through tunnel `26bfe8b1` to `localhost:3000`
- [x] **GitHub App & Webhooks** — Auto-deploy on push via webhook delivery to tunnel URL

### Database (Supabase Migration)
- [x] **Migrated local PostgreSQL → Supabase** (AWS Sydney pooler: `aws-1-ap-southeast-2.pooler.supabase.com`)
- [x] **Removed local `click-deploy-db` container** — platform is now fully stateless on `manager-01`
- [x] **Fixed password hashes** — bcrypt (`$2b$`) → scrypt (`salt:key`) format for better-auth compatibility
- [x] **RLS Security hardening** — All 20 public tables locked with `Deny all` policies
- [x] **Realtime UI sync** — `ui_events` broadcast table + PostgreSQL triggers on critical tables → `useRealtimeSync` hook invalidates tRPC cache on every DB change

### Auth
- [x] **`BETTER_AUTH_URL`** corrected to `https://deploy.clickbit.com.au`
- [x] **`auth-client.ts`** simplified — no more hardcoded `baseURL`, infers from browser origin
- [x] **`auth.ts` server** — reads `BETTER_AUTH_URL` from env instead of missing `NEXT_PUBLIC_APP_URL`

### Engine Improvements (user-authored)
- [x] **Deployment cancellation** — `AbortController`-based cancel with SSH cleanup of build processes
- [x] **Auto-detect Dockerfile** — Falls back to nixpacks only if no Dockerfile exists in repo
- [x] **Deployment duration tracking** — UI shows total build + deploy time
- [x] **Cancel button** — Visible on active deployments in the detail view

---

## 🔄 In Progress / Waiting On

### Deploy & Test End-to-End
- [ ] **Full deployment test** — Trigger a fresh deployment through the UI and verify the entire pipeline works: clone → build → push to registry → deploy via Swarm → live container
- [ ] **Verify Realtime UI** — Confirm deployment status changes propagate instantly to the browser without manual refresh
- [ ] **Verify cancel flow** — Start a build and cancel mid-flight, confirm processes are killed and status shows "Cancelled"

### SMTP Configuration
- [ ] **SMTP settings UI** — Add email provider config (host, port, user, pass) to the Settings page so the platform can send deployment notifications, password resets, etc.

---

## 📋 Future / Planned

### High Availability (HA) Deployment
> **Blocked on:** Acquiring 2x VPS servers

1. Connect VPS 1 and VPS 2 as **Manager Nodes** → creates a 3-manager quorum (Proxmox + 2x VPS)
2. Transition Click-Deploy itself from `docker compose` → **replicated `docker stack`** (3 replicas across managers)
3. Traefik on each VPS handles routing → requests to VPS public IPs get routed to the correct app
4. **Result:** If any single node (including Proxmox) goes down, the platform UI and API survive on the remaining 2 managers

### Platform Updates System
- [ ] One-click update from the dashboard (already prototyped — pulls latest code and rebuilds on `manager-01`)
- [ ] Verify zero-downtime update when running as replicated Swarm stack

### Registry Improvements
- [ ] Make the Docker registry globally accessible (currently LAN-only, which forces builds to happen on `manager-01` or nodes with LAN access)
- [ ] Consider using a cloud registry (GHCR, Docker Hub) as a fallback for remote build nodes

### Client App Hosting
- [ ] Deploy client applications on VPS nodes (once VPS servers are acquired)
- [ ] Ensure Traefik routes client domains correctly to the right containers across the cluster

---

## 🌐 Environment Reference

| Component | Value |
|---|---|
| **Manager Node** | `10.10.20.30` / `100.79.49.5` (Tailscale) |
| **Sydney Node** | `10.10.20.31` |
| **Worker Node** | `worker-01` |
| **Registry** | `10.10.20.30:5000` |
| **Database** | Supabase (Sydney pooler) |
| **Web UI** | `https://deploy.clickbit.com.au` |
| **Auth** | better-auth (scrypt, 30-day sessions) |
| **Tunnel** | Cloudflare `26bfe8b1-8897-4f2b-af6a-8457b63433d9` |
