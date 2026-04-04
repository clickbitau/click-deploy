# Click-Deploy Infrastructure Guide

## Docker Swarm Setup

Click-Deploy uses Docker Swarm for container orchestration across multiple nodes.
The Swarm manager **must** advertise on a Tailscale IP so that remote nodes can join.

### Swarm Initialization

```bash
# On the primary manager node:
docker swarm init --advertise-addr <TAILSCALE_IP> --listen-addr 0.0.0.0:2377
```

The `--listen-addr 0.0.0.0:2377` ensures the Swarm port is accessible on both
LAN and Tailscale interfaces.

### Joining Nodes

**Remote nodes (Tailscale):**
```bash
docker swarm join \
  --token <TOKEN> \
  --advertise-addr <NODE_TAILSCALE_IP> \
  --listen-addr 0.0.0.0:2377 \
  <MANAGER_TAILSCALE_IP>:2377
```

**LAN nodes (same network as manager):**
```bash
docker swarm join \
  --token <TOKEN> \
  --advertise-addr <NODE_LAN_IP> \
  <MANAGER_LAN_IP>:2377
```

---

## Tailscale Requirements

### TUN Device (Required for Swarm Managers)

Docker Swarm's Raft consensus protocol requires kernel-level TCP routing to
Tailscale IPs. This means Tailscale **must** run in TUN mode (not userspace
networking) on all nodes that participate in the Swarm.

**Tailscale in userspace mode** (`--tun=userspace-networking`) creates a SOCKS5
proxy but no kernel network interface. Docker's Swarm manager cannot route Raft
traffic through a SOCKS5 proxy — it needs a real `tailscale0` interface.

### Proxmox LXC Containers

LXC containers do not have `/dev/net/tun` by default. To enable TUN:

1. **On the Proxmox host**, edit the container config:

```bash
# /etc/pve/lxc/<VMID>.conf
# Add these lines:
lxc.cgroup2.devices.allow: c 10:200 rwm
lxc.mount.entry: /dev/net dev/net none bind,create=dir
```

2. **Reboot the container:**
```bash
pct reboot <VMID>
```

3. **Switch Tailscale to TUN mode:**

If Tailscale was previously using userspace networking, update the service:

```bash
# Check current mode:
ps aux | grep tailscaled

# If you see --tun=userspace-networking, fix it:
# Edit /etc/systemd/system/tailscaled.service.d/override.conf
# or /etc/default/tailscaled — remove the --tun=userspace-networking flag

systemctl daemon-reload
systemctl restart tailscaled

# Verify tailscale0 interface exists:
ip addr show tailscale0
```

### VPS / Bare-Metal Servers

Most VPS providers and bare-metal servers already have `/dev/net/tun` available.
Tailscale should work in TUN mode out of the box. No special configuration needed.

---

## Self-Hosted Docker Registry

The registry runs as a **global** Docker Swarm service — one instance per node.
All instances share the same storage backend (Supabase S3).

### Architecture

```
┌─────────────────────────────────────┐
│      Supabase S3 Bucket             │
│   (shared storage for all nodes)    │
└──────┬──────────┬──────────┬────────┘
       │          │          │
   Registry   Registry   Registry
   :5000      :5000      :5000
   Node A     Node B     Node C
```

### Why S3?

Each registry instance is stateless — it reads/writes to the same S3 bucket.
This means:
- Push an image to any node → all nodes can pull it
- A node goes down → other nodes still serve images
- Add a new node → it gets a registry automatically (global mode)

### Environment Variables

The registry service uses these env vars:

| Variable | Description |
|----------|-------------|
| `REGISTRY_STORAGE` | `s3` |
| `REGISTRY_STORAGE_S3_REGIONENDPOINT` | S3-compatible endpoint URL |
| `REGISTRY_STORAGE_S3_ACCESSKEY` | S3 access key |
| `REGISTRY_STORAGE_S3_SECRETKEY` | S3 secret key |
| `REGISTRY_STORAGE_S3_BUCKET` | Bucket name |
| `REGISTRY_STORAGE_S3_REGION` | Region (default: `us-east-1`) |
| `REGISTRY_STORAGE_S3_FORCEPATHSTYLE` | `true` for Supabase/MinIO |
| `REGISTRY_STORAGE_REDIRECT_DISABLE` | `true` (disable S3 redirect) |
| `REGISTRY_HTTP_SECRET` | Shared secret for multi-replica consistency |

---

## Required Ports

### Docker Swarm
| Port | Protocol | Purpose |
|------|----------|---------|
| 2377 | TCP | Cluster management (Raft) |
| 7946 | TCP/UDP | Node communication (Gossip) |
| 4789 | UDP | Overlay network (VXLAN) |

### Services
| Port | Protocol | Purpose |
|------|----------|---------|
| 5000 | TCP | Docker Registry |
| 80 | TCP | Traefik HTTP |
| 443 | TCP | Traefik HTTPS |
| 3000 | TCP | Click-Deploy Dashboard |

### Tailscale
| Port | Protocol | Purpose |
|------|----------|---------|
| 41641 | UDP | WireGuard direct connection |

> **Note:** If Tailscale uses DERP relay (no direct connection), Swarm still
> works but with higher latency. For best performance, open UDP 41641 on both
> ends to enable direct peering.
