# Click-Deploy

**Self-Hosted PaaS — Deploy, manage, and scale your applications with a single click.**

A self-hosted alternative to Heroku, Vercel, Coolify, and Dokploy. Full control over your infrastructure, no vendor lock-in, no surprise bills.

## Features

- **One-Click Deploy** — Push to Git and your app deploys automatically, or trigger manually from the dashboard
- **Automatic SSL** — Free certificates via Let's Encrypt, auto-provisioned and renewed for every domain
- **Docker Native** — Build from Dockerfile or deploy pre-built images with Docker Swarm orchestration
- **Multi-Node Clusters** — Deploy across multiple servers with manager, worker, and build node roles
- **Instant Rollbacks** — Revert to any previous deployment with a single click
- **Real-Time Monitoring** — CPU, memory, and disk usage per node with health checks
- **Notifications** — Slack, Discord, Email, Webhook, and Telegram alerts for deploy events
- **Traefik Integration** — Automatic reverse proxy with domain routing and SSL termination
- **Secure** — SSH keys encrypted at rest (AES-256-GCM), webhook signatures verified (HMAC-SHA256)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 16, React 19, TypeScript |
| **Styling** | Custom design system with CSS variables, glassmorphism |
| **API** | tRPC v11 with 12 router namespaces |
| **Auth** | better-auth (email/password + GitHub OAuth) |
| **Database** | PostgreSQL with Drizzle ORM |
| **Infrastructure** | Docker Swarm, Traefik v3.3, SSH2 |
| **Build System** | Turborepo monorepo |

## Project Structure

```
click-deploy/
├── apps/
│   └── web/                    # Next.js dashboard & landing page
│       ├── app/
│       │   ├── (auth)/         # Login & registration
│       │   ├── (dashboard)/    # Dashboard with 10+ pages
│       │   └── api/            # Webhooks, tRPC, auth endpoints
│       ├── components/         # Shared UI components (SlideOver, etc.)
│       └── lib/                # tRPC client, auth client
├── packages/
│   ├── api/                    # tRPC routers & deployment engine
│   │   └── src/
│   │       ├── routers/        # 12 route namespaces
│   │       ├── engine.ts       # DeploymentEngine (build → push → deploy)
│   │       ├── crypto.ts       # AES-256-GCM key encryption
│   │       └── heartbeat.ts    # Node health monitoring
│   ├── database/               # Drizzle schema & client
│   │   └── src/schema/         # 5 schema modules
│   └── docker/                 # Docker managers
│       └── src/
│           ├── swarm.ts        # SwarmManager
│           ├── traefik.ts      # TraefikManager
│           └── registry.ts     # RegistryManager
└── turbo.json
```

## Deployment

### Option 1: One-Line Install (Recommended)

SSH into your VPS/server and run:

```bash
curl -fsSL https://raw.githubusercontent.com/youruser/click-deploy/main/install.sh | sudo bash
```

This will:
- Install Docker if not already present (Ubuntu, Debian, CentOS, Alpine, Arch)
- Set up PostgreSQL + Click-Deploy via Docker Compose
- Generate secure secrets automatically
- Start everything on port 3000

**Supported platforms:** Ubuntu, Debian, CentOS, RHEL, Rocky, Alpine, Arch, Fedora, or any Linux with Docker.

### Option 2: Docker Compose (Manual)

```bash
# Clone the repository
git clone https://github.com/youruser/click-deploy.git /opt/click-deploy
cd /opt/click-deploy

# Create .env from example
cp .env.example .env
# Edit .env — set POSTGRES_PASSWORD, BETTER_AUTH_SECRET, ENCRYPTION_KEY
nano .env

# Build and start
docker compose up -d

# Open http://your-server-ip:3000
```

### Option 3: Pre-Built Docker Image

```bash
# Pull and run (bring your own PostgreSQL)
docker run -d \
  --name click-deploy \
  -p 3000:3000 \
  -e DATABASE_URL=postgresql://user:pass@host:5432/clickdeploy \
  -e BETTER_AUTH_SECRET=your-secret \
  -e ENCRYPTION_KEY=your-key \
  ghcr.io/youruser/click-deploy:latest
```

### Option 4: Development (Local)

```bash
# Prerequisites: Node.js 22+, pnpm 9+, PostgreSQL

# Clone and install
git clone https://github.com/youruser/click-deploy.git
cd click-deploy
pnpm install

# Set up environment
cp .env.example apps/web/.env.local

# Push database schema
pnpm db:push

# Start dev server
pnpm dev
# → http://localhost:3000
```

### Environment Variables

```env
# Required
DATABASE_URL=postgresql://user:password@localhost:5432/clickdeploy
BETTER_AUTH_SECRET=your-secret-key-at-least-32-chars
BETTER_AUTH_URL=http://localhost:3000
ENCRYPTION_KEY=your-32-byte-hex-encryption-key

# Optional
GITHUB_CLIENT_ID=      # GitHub OAuth login
GITHUB_CLIENT_SECRET=  # GitHub OAuth login
GITHUB_WEBHOOK_SECRET= # Auto-deploy on git push
CLOUDFLARE_API_TOKEN=  # Cloudflare tunnel integration
```

## Usage Guide

### 1. Create an Account

Navigate to `http://localhost:3000/register` and create your admin account.

### 2. Add a Node

Go to **Dashboard → Nodes → Add Node**:
1. Generate or select an SSH key
2. Copy the public key to your server's `~/.ssh/authorized_keys`
3. Enter your server's hostname, port, and SSH user
4. Click "Test & Add Node" to verify connectivity

### 3. Set Up Infrastructure

Go to **Dashboard → Settings → Infrastructure**:
1. Click **Deploy Traefik** to set up the reverse proxy
2. Click **Deploy Registry** to set up a private Docker registry
3. Copy the GitHub Webhook URL for auto-deployments

### 4. Create a Project

Go to **Dashboard → Projects → New Project**:
1. Name your project and select an environment
2. Add a service (Git repo or Docker image)
3. Configure the container port

### 5. Add a Domain

In the **Service Detail → Domains** tab:
1. Point your domain's DNS A record to your server's IP
2. Add the domain in the dashboard
3. SSL will be provisioned automatically via Let's Encrypt

### 6. Deploy

Either:
- **Push to Git** — If you set up the GitHub webhook, pushes to the configured branch will auto-deploy
- **Manual Deploy** — Click "Deploy Now" on the service detail page
- **Dashboard → Deployments → Manual Deploy** — Select a service and trigger

### 7. Monitor

- **Dashboard → Monitoring** — Real-time cluster resource usage
- **Dashboard → Notifications** — Set up Slack/Discord/Email alerts
- **Dashboard → Deployments** — View build & deploy logs for any deployment

## Architecture

```
Git Push → GitHub Webhook → Verify HMAC Signature → DeploymentEngine
                                                        ↓
                                              Clone → Docker Build
                                                        ↓
                                              Push to Registry
                                                        ↓
                                              Deploy to Swarm
                                                        ↓
                                              Inject Traefik Labels
                                                        ↓
                                              Monitor Health
```

## License

MIT
