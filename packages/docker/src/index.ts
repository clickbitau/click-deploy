// ============================================================
// Click-Deploy — Docker Package Barrel Export
// ============================================================
export { SSHConnectionManager, sshManager, type SSHConnectionConfig, type SSHConnection } from './ssh';
export { getDockerClient, RemoteDockerCLI, createRemoteCLI, type NodeConnectionInfo } from './client';
export { SwarmManager, DEFAULT_DEPLOY_CONFIG } from './swarm';
export {
  TraefikManager,
  RegistryManager,
  generateTraefikLabels,
  generateSimpleTraefikLabels,
  type TraefikConfig,
  type TraefikRouteConfig,
  type RegistryS3Config,
} from './traefik';
export { TailscaleManager, type TailscaleStatus } from './tailscale';

