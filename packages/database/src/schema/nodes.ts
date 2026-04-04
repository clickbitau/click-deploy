// ============================================================
// Click-Deploy — Node & SSH Key Schema
// ============================================================
import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  varchar,
  integer,
  boolean,
  pgEnum,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { organizations } from './auth';

// ── Enums ──────────────────────────────────────────────────
export const nodeRoleEnum = pgEnum('node_role', ['manager', 'worker', 'build']);
export const nodeStatusEnum = pgEnum('node_status', ['online', 'offline', 'maintenance']);
export const swarmStatusEnum = pgEnum('swarm_status', ['active', 'drain', 'unknown']);

// ── SSH Keys ───────────────────────────────────────────────
export const sshKeys = pgTable('ssh_keys', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  privateKey: text('private_key').notNull(), // encrypted
  publicKey: text('public_key'),
  fingerprint: varchar('fingerprint', { length: 100 }),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  orgIdx: index('idx_ssh_keys_org').on(table.organizationId),
}));

// ── Nodes ──────────────────────────────────────────────────
export const nodes = pgTable('nodes', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  role: nodeRoleEnum('role').notNull(),
  host: varchar('host', { length: 255 }).notNull(),
  port: integer('port').notNull().default(22),
  sshUser: varchar('ssh_user', { length: 100 }).notNull().default('root'),
  sshKeyId: uuid('ssh_key_id').notNull().references(() => sshKeys.id, { onDelete: 'restrict' }),
  dockerVersion: varchar('docker_version', { length: 50 }),
  /** Docker endpoint — 'unix:///var/run/docker.sock' (default) or 'tcp://host:2376' */
  dockerEndpoint: varchar('docker_endpoint', { length: 255 }).default('unix:///var/run/docker.sock'),
  /** Whether this node is a bare-metal host or running inside a container (LXC, Docker-in-Docker) */
  runtimeType: varchar('runtime_type', { length: 20 }).default('host'), // 'host' | 'container'
  swarmNodeId: varchar('swarm_node_id', { length: 100 }),
  swarmStatus: swarmStatusEnum('swarm_status').default('unknown'),
  labels: jsonb('labels').default({}),
  resources: jsonb('resources').default({}), // { cpuCores, memoryGb, diskGb }
  /** Whether this node can be used for building images */
  canBuild: boolean('can_build').notNull().default(true),
  /** Whether this node can be used for deploying/running services */
  canDeploy: boolean('can_deploy').notNull().default(true),
  lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
  status: nodeStatusEnum('status').notNull().default('offline'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  orgIdx: index('idx_nodes_org').on(table.organizationId),
  sshKeyIdx: index('idx_nodes_ssh_key').on(table.sshKeyId),
}));

// ── Relations ──────────────────────────────────────────────
export const sshKeysRelations = relations(sshKeys, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [sshKeys.organizationId],
    references: [organizations.id],
  }),
  nodes: many(nodes),
}));

export const nodesRelations = relations(nodes, ({ one }) => ({
  organization: one(organizations, {
    fields: [nodes.organizationId],
    references: [organizations.id],
  }),
  sshKey: one(sshKeys, {
    fields: [nodes.sshKeyId],
    references: [sshKeys.id],
  }),
}));
