---
description: Add a new VPS node as a Swarm Manager to achieve 3-manager Raft quorum
---

# Swarm Manager Promotion — 3-Manager Raft Quorum

This workflow promotes a new VPS to a Docker Swarm manager node, establishing a
fault-tolerant Raft quorum. With 3 managers, the Swarm can tolerate **1 manager failure**
without losing orchestration capability.

## Prerequisites

- An existing Swarm with 1 manager (`docker node ls` shows `Leader`)
- A fresh VPS with Docker installed and accessible via Tailscale
- SSH access to both the existing manager and the new VPS
- The new VPS must be joined to the Tailscale network first

---

## Phase 0 — Pre-Flight on Existing Manager

SSH into the current Swarm manager (click-deploy):

```bash
# Verify current Swarm state
docker node ls

# Expected output — 1 manager (Leader), N workers:
# ID                         HOSTNAME        STATUS    AVAILABILITY  MANAGER STATUS
# xxxx * (Leader)            click-deploy    Ready     Active        Leader
# yyyy                       perth-swarm     Ready     Active
# zzzz                       hr-soft         Ready     Active

# Confirm Raft is healthy
docker info | grep -A5 "Swarm:"
# Manager Status: active
# Raft Status: healthy
```

---

## Phase 1 — Generate a Manager Join Token

On the **existing manager**:

```bash
# Get the manager join token (keep this secret — it grants full cluster control)
docker swarm join-token manager

# Output will look like:
# To add a manager to this swarm, run the following command:
#
#     docker swarm join \
#       --token SWMTKN-1-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
#       100.x.x.x:2377
#
# Copy the full docker swarm join command above.
```

> **Security note:** This token grants full Swarm manager access. Treat it like a root credential.
> Rotate it after use: `docker swarm join-token --rotate manager`

---

## Phase 2 — Prepare the New VPS Node

SSH into the **new VPS**:

```bash
# 1. Verify Docker is installed
docker version

# 2. Verify Tailscale is connected
tailscale ip -4
# Expected: 100.x.x.x

# 3. Confirm it can reach the manager
curl -s --connect-timeout 5 http://100.<manager-ip>:2377 || echo "Port 2377 reachable"

# 4. If Docker isn't installed:
curl -fsSL https://get.docker.com | sh
```

---

## Phase 3 — Join the Swarm as Manager

On the **new VPS**, paste the join command from Phase 1:

```bash
docker swarm join \
  --token SWMTKN-1-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  100.<manager-tailscale-ip>:2377
```

Expected output:
```
This node joined a swarm as a manager.
```

---

## Phase 4 — Verify the 3-Manager Quorum

Back on the **existing manager**:

```bash
# Should now show 2 managers (1 Leader, 1 Reachable)
docker node ls

# ID                         HOSTNAME        STATUS    AVAILABILITY  MANAGER STATUS
# xxxx * (Leader)            click-deploy    Ready     Active        Leader
# aaaa                       new-vps-node    Ready     Active        Reachable
# yyyy                       perth-swarm     Ready     Active
# zzzz                       hr-soft         Ready     Active

# Verify Raft is still healthy with 2 managers
docker info | grep "Raft Status"
# Raft Status: healthy
```

> **Add a third manager** by repeating Phases 1–4 with another VPS to achieve full quorum.
> With 3 managers: fault tolerance = 1 (any 1 manager can fail and Swarm continues).

---

## Phase 5 — Label the New Manager Node

```bash
# On the existing manager — add role label for stack placement constraints
docker node update --label-add role=manager new-vps-node

# Verify
docker node inspect new-vps-node --format '{{ .Spec.Labels }}'
```

---

## Phase 6 — Register in Click-Deploy Dashboard

1. Navigate to `/dashboard/nodes`
2. Click **Add Node**
3. Fill in:
   - **Name:** `new-vps-node`
   - **Role:** `manager`
   - **Host:** `100.x.x.x` (Tailscale IP)
   - **SSH User:** `root`
   - **SSH Key:** select the org key
4. Click **Add Node** — auto-connectivity test will run and register the Swarm ID

---

## Phase 7 — Redeploy the Stack (Optional: Distribute Replicas)

```bash
# On any manager — force rebalance so app replicas spread to new node
docker service update --force click-deploy_app

# Verify replicas are now on different nodes
docker service ps click-deploy_app
```

---

## Phase 8 — Rotate the Join Token

```bash
# Invalidate the old manager token (security hygiene)
docker swarm join-token --rotate manager

# Generate a new worker token too if any workers used the old approach
docker swarm join-token --rotate worker
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Error: manager is not part of a swarm` | Run `docker swarm init` on manager first |
| `dial tcp: connection refused on 2377` | Check firewall — port 2377/tcp must be open between Tailscale IPs |
| Node joins as worker instead of manager | You used the worker token — re-run with `join-token manager` |
| `Raft: failed to join` | Ensure system clocks are in sync: `timedatectl` on both nodes |
| New manager shows `Unreachable` | Check `docker info` on the new node — may need `systemctl restart docker` |

---

## Raft Quorum Reference

| Managers | Fault Tolerance | Min. for Quorum |
|---|---|---|
| 1 | 0 | 1 |
| **3** | **1** | **2** |
| 5 | 2 | 3 |

**Recommendation:** Stay at an **odd** number of managers (3 or 5). Even numbers don't increase fault tolerance.
