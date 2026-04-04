// ============================================================
// Click-Deploy — Shared Constants
// ============================================================

export const APP_NAME = 'Click-Deploy' as const;
export const APP_VERSION = '0.1.0' as const;

// ── Service Types ──────────────────────────────────────────
export const SERVICE_TYPES = [
  'application',
  'database',
  'compose',
  'redis',
  'postgres',
  'mysql',
  'mongo',
  'mariadb',
] as const;

export const SOURCE_TYPES = ['git', 'image', 'compose'] as const;

// ── Deployment ─────────────────────────────────────────────
export const DEPLOY_STATUSES = [
  'pending',
  'building',
  'built',
  'deploying',
  'running',
  'failed',
  'rolled_back',
  'cancelled',
] as const;

export const BUILD_STATUSES = [
  'pending',
  'building',
  'built',
  'failed',
  'cancelled',
] as const;

export const DEPLOY_TRIGGERS = [
  'webhook',
  'manual',
  'rollback',
  'schedule',
  'api',
] as const;

// ── Node ───────────────────────────────────────────────────
export const NODE_ROLES = ['manager', 'worker', 'build'] as const;
export const NODE_STATUSES = ['online', 'offline', 'maintenance'] as const;
export const SWARM_STATUSES = ['active', 'drain', 'unknown'] as const;

// ── Organization ───────────────────────────────────────────
export const ORG_PLANS = ['free', 'pro', 'enterprise'] as const;
export const USER_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;

// ── Environment ────────────────────────────────────────────
export const ENVIRONMENTS = ['production', 'staging', 'development'] as const;

// ── Service Status ─────────────────────────────────────────
export const SERVICE_STATUSES = [
  'running',
  'stopped',
  'deploying',
  'failed',
  'unknown',
] as const;

// ── SSL Providers ──────────────────────────────────────────
export const SSL_PROVIDERS = ['letsencrypt', 'cloudflare', 'custom', 'none'] as const;

// ── Registry Types ─────────────────────────────────────────
export const REGISTRY_TYPES = [
  'dockerhub',
  'ghcr',
  'ecr',
  'self_hosted',
  'custom',
] as const;

// ── Notification Types ─────────────────────────────────────
export const NOTIFICATION_TYPES = [
  'slack',
  'discord',
  'telegram',
  'email',
  'webhook',
] as const;

export const NOTIFICATION_EVENTS = [
  'deploy_success',
  'deploy_fail',
  'service_down',
  'service_up',
  'node_offline',
  'node_online',
  'build_fail',
  'certificate_expiring',
] as const;

// ── Git Providers ──────────────────────────────────────────
export const GIT_PROVIDERS = ['github', 'gitlab', 'gitea', 'bitbucket'] as const;

// ── Resource Defaults ──────────────────────────────────────
export const DEFAULT_HEALTH_CHECK = {
  path: '/',
  interval: 30,
  timeout: 10,
  retries: 3,
  startPeriod: 60,
} as const;

export const DEFAULT_UPDATE_CONFIG = {
  parallelism: 1,
  delay: '10s',
  failureAction: 'rollback' as const,
  monitor: '30s',
  maxFailureRatio: 0,
} as const;

export const DEFAULT_ROLLBACK_CONFIG = {
  parallelism: 1,
  delay: '5s',
} as const;
