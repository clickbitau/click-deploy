// ============================================================
// Click-Deploy — Shared Type Definitions
// ============================================================
import type {
  SERVICE_TYPES,
  SOURCE_TYPES,
  NODE_ROLES,
  NODE_STATUSES,
  SWARM_STATUSES,
  ENVIRONMENTS,
  SERVICE_STATUSES,
  DEPLOY_STATUSES,
  BUILD_STATUSES,
  DEPLOY_TRIGGERS,
  SSL_PROVIDERS,
  REGISTRY_TYPES,
  NOTIFICATION_TYPES,
  NOTIFICATION_EVENTS,
  GIT_PROVIDERS,
  USER_ROLES,
  ORG_PLANS,
} from './constants.js';

// ── Utility Types ──────────────────────────────────────────
export type ArrayElement<T extends readonly unknown[]> = T[number];

// ── Enums as Types ─────────────────────────────────────────
export type ServiceType = ArrayElement<typeof SERVICE_TYPES>;
export type SourceType = ArrayElement<typeof SOURCE_TYPES>;
export type NodeRole = ArrayElement<typeof NODE_ROLES>;
export type NodeStatus = ArrayElement<typeof NODE_STATUSES>;
export type SwarmStatus = ArrayElement<typeof SWARM_STATUSES>;
export type Environment = ArrayElement<typeof ENVIRONMENTS>;
export type ServiceStatus = ArrayElement<typeof SERVICE_STATUSES>;
export type DeployStatus = ArrayElement<typeof DEPLOY_STATUSES>;
export type BuildStatus = ArrayElement<typeof BUILD_STATUSES>;
export type DeployTrigger = ArrayElement<typeof DEPLOY_TRIGGERS>;
export type SSLProvider = ArrayElement<typeof SSL_PROVIDERS>;
export type RegistryType = ArrayElement<typeof REGISTRY_TYPES>;
export type NotificationType = ArrayElement<typeof NOTIFICATION_TYPES>;
export type NotificationEvent = ArrayElement<typeof NOTIFICATION_EVENTS>;
export type GitProvider = ArrayElement<typeof GIT_PROVIDERS>;
export type UserRole = ArrayElement<typeof USER_ROLES>;
export type OrgPlan = ArrayElement<typeof ORG_PLANS>;

// ── WebSocket Event Types ──────────────────────────────────
export interface DeploymentLogEvent {
  deploymentId: string;
  phase: 'build' | 'deploy';
  line: string;
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'debug';
}

export interface DeploymentStatusEvent {
  deploymentId: string;
  serviceId: string;
  buildStatus: BuildStatus;
  deployStatus: DeployStatus;
  errorMessage?: string;
}

export interface NodeMetricsEvent {
  nodeId: string;
  timestamp: number;
  cpu: {
    usagePercent: number;
    cores: number;
  };
  memory: {
    usedBytes: number;
    totalBytes: number;
    usagePercent: number;
  };
  disk: {
    usedBytes: number;
    totalBytes: number;
    usagePercent: number;
  };
  network: {
    rxBytes: number;
    txBytes: number;
  };
}

export interface ContainerStatsEvent {
  serviceId: string;
  containerId: string;
  nodeId: string;
  cpu: number;
  memoryUsage: number;
  memoryLimit: number;
  networkRx: number;
  networkTx: number;
}

// ── API Response Types ─────────────────────────────────────
export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// ── Docker Types ───────────────────────────────────────────
export interface DockerServiceInfo {
  id: string;
  name: string;
  image: string;
  replicas: {
    running: number;
    desired: number;
  };
  ports: Array<{
    target: number;
    published: number;
    protocol: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface DockerContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  nodeId: string;
  ports: Array<{
    ip: string;
    privatePort: number;
    publicPort: number;
    type: string;
  }>;
  createdAt: string;
}

export interface SwarmNodeInfo {
  id: string;
  hostname: string;
  role: 'manager' | 'worker';
  availability: 'active' | 'pause' | 'drain';
  status: 'ready' | 'down' | 'disconnected' | 'unknown';
  ip: string;
  engineVersion: string;
  os: string;
  architecture: string;
  cpus: number;
  memoryBytes: number;
  labels: Record<string, string>;
}
