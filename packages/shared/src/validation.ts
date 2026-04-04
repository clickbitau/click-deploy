// ============================================================
// Click-Deploy — Zod Validation Schemas
// ============================================================
import { z } from 'zod';
import {
  SERVICE_TYPES,
  SOURCE_TYPES,
  NODE_ROLES,
  NODE_STATUSES,
  ENVIRONMENTS,
  SERVICE_STATUSES,
  SSL_PROVIDERS,
  REGISTRY_TYPES,
  NOTIFICATION_TYPES,
  NOTIFICATION_EVENTS,
  GIT_PROVIDERS,
  USER_ROLES,
  ORG_PLANS,
  DEPLOY_TRIGGERS,
} from './constants.js';

// ── Auth ───────────────────────────────────────────────────
export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(2, 'Name must be at least 2 characters'),
  organizationName: z.string().min(2, 'Organization name is required'),
});

// ── Organization ───────────────────────────────────────────
export const createOrganizationSchema = z.object({
  name: z.string().min(2).max(100),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
});

// ── Project ────────────────────────────────────────────────
export const createProjectSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional(),
  environment: z.enum(ENVIRONMENTS).default('production'),
});

export const updateProjectSchema = createProjectSchema.partial();

// ── Service ────────────────────────────────────────────────
export const portMappingSchema = z.object({
  host: z.number().int().min(1).max(65535),
  container: z.number().int().min(1).max(65535),
  protocol: z.enum(['tcp', 'udp']).default('tcp'),
});

export const volumeMappingSchema = z.object({
  host: z.string().min(1),
  container: z.string().min(1),
  readOnly: z.boolean().default(false),
});

export const healthCheckSchema = z.object({
  path: z.string().default('/'),
  interval: z.number().int().min(5).default(30),
  timeout: z.number().int().min(1).default(10),
  retries: z.number().int().min(1).max(10).default(3),
  startPeriod: z.number().int().min(0).default(60),
});

export const resourceLimitsSchema = z.object({
  cpus: z.string().optional(), // e.g., "0.5", "2"
  memory: z.string().optional(), // e.g., "512M", "2G"
  memoryReservation: z.string().optional(),
});

export const updateConfigSchema = z.object({
  parallelism: z.number().int().min(0).default(1),
  delay: z.string().default('10s'),
  failureAction: z.enum(['rollback', 'pause', 'continue']).default('rollback'),
  monitor: z.string().default('30s'),
  maxFailureRatio: z.number().min(0).max(1).default(0),
});

export const createServiceSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Must be lowercase alphanumeric with hyphens'),
  projectId: z.string().uuid(),
  type: z.enum(SERVICE_TYPES).default('application'),
  sourceType: z.enum(SOURCE_TYPES),

  // Git source
  gitUrl: z.string().url().optional(),
  gitBranch: z.string().default('main').optional(),
  gitProvider: z.enum(GIT_PROVIDERS).optional(),

  // Dockerfile
  dockerfilePath: z.string().default('Dockerfile').optional(),
  dockerContext: z.string().default('.').optional(),

  // Compose
  composeFile: z.string().optional(),

  // Image source
  imageName: z.string().optional(),
  imageTag: z.string().default('latest').optional(),

  // Node placement
  buildNodeId: z.string().uuid().optional(),
  targetNodeId: z.string().uuid().optional(),

  // Config
  replicas: z.number().int().min(0).default(1),
  envVars: z.record(z.string(), z.string()).default({}),
  ports: z.array(portMappingSchema).default([]),
  volumes: z.array(volumeMappingSchema).default([]),
  healthCheck: healthCheckSchema.optional(),
  deployConfig: updateConfigSchema.optional(),
  resourceLimits: resourceLimitsSchema.optional(),
  labels: z.record(z.string(), z.string()).default({}),
  autoDeploy: z.boolean().default(true),
});

export const updateServiceSchema = createServiceSchema.partial().omit({ projectId: true });

// ── Node ───────────────────────────────────────────────────
export const createNodeSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  role: z.enum(NODE_ROLES),
  host: z.string().min(1, 'Host IP or hostname required'),
  port: z.number().int().min(1).max(65535).default(22),
  sshUser: z.string().min(1).default('root'),
  sshKeyId: z.string().uuid(),
  labels: z.record(z.string(), z.string()).default({}),
});

export const updateNodeSchema = createNodeSchema.partial();

// ── SSH Key ────────────────────────────────────────────────
export const createSSHKeySchema = z.object({
  name: z.string().min(1).max(100),
  privateKey: z.string().min(1, 'Private key is required'),
  publicKey: z.string().optional(),
});

// ── Domain ─────────────────────────────────────────────────
export const createDomainSchema = z.object({
  serviceId: z.string().uuid(),
  hostname: z.string().min(1).regex(
    /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/,
    'Invalid hostname',
  ),
  sslEnabled: z.boolean().default(true),
  sslProvider: z.enum(SSL_PROVIDERS).default('letsencrypt'),
  tunnelId: z.string().uuid().optional(),
});

// ── Registry ───────────────────────────────────────────────
export const createRegistrySchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(REGISTRY_TYPES),
  url: z.string().url(),
  username: z.string().optional(),
  password: z.string().optional(),
  isDefault: z.boolean().default(false),
});

// ── Tunnel ─────────────────────────────────────────────────
export const createTunnelSchema = z.object({
  name: z.string().min(1).max(100),
  cloudflareAccountId: z.string().min(1),
  nodeId: z.string().uuid(),
});

export const createTunnelRouteSchema = z.object({
  tunnelId: z.string().uuid(),
  hostname: z.string().min(1),
  service: z.string().min(1), // e.g., "http://traefik:80"
});

// ── Notification ───────────────────────────────────────────
export const createNotificationChannelSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(NOTIFICATION_TYPES),
  config: z.record(z.string(), z.unknown()),
});

export const createNotificationRuleSchema = z.object({
  channelId: z.string().uuid(),
  event: z.enum(NOTIFICATION_EVENTS),
});

// ── Deployment (manual trigger) ────────────────────────────
export const triggerDeploySchema = z.object({
  serviceId: z.string().uuid(),
  branch: z.string().optional(),
  commitSha: z.string().optional(),
});

// ── Export all types ───────────────────────────────────────
export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;
export type CreateNodeInput = z.infer<typeof createNodeSchema>;
export type UpdateNodeInput = z.infer<typeof updateNodeSchema>;
export type CreateSSHKeyInput = z.infer<typeof createSSHKeySchema>;
export type CreateDomainInput = z.infer<typeof createDomainSchema>;
export type CreateRegistryInput = z.infer<typeof createRegistrySchema>;
export type CreateTunnelInput = z.infer<typeof createTunnelSchema>;
export type CreateTunnelRouteInput = z.infer<typeof createTunnelRouteSchema>;
export type TriggerDeployInput = z.infer<typeof triggerDeploySchema>;
export type PortMapping = z.infer<typeof portMappingSchema>;
export type VolumeMapping = z.infer<typeof volumeMappingSchema>;
export type HealthCheck = z.infer<typeof healthCheckSchema>;
export type ResourceLimits = z.infer<typeof resourceLimitsSchema>;
export type UpdateConfig = z.infer<typeof updateConfigSchema>;
