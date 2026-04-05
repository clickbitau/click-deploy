// ============================================================
// Click-Deploy — Project & Service Schema
// ============================================================
import {
  pgTable,
  text,
  timestamp,
  boolean,
  jsonb,
  uuid,
  varchar,
  integer,
  pgEnum,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { organizations } from './auth';

// ── Enums ──────────────────────────────────────────────────
export const environmentEnum = pgEnum('environment', ['production', 'staging', 'development']);
export const serviceTypeEnum = pgEnum('service_type', [
  'application', 'database', 'compose', 'redis', 'postgres', 'mysql', 'mongo', 'mariadb',
]);
export const sourceTypeEnum = pgEnum('source_type', ['git', 'image', 'compose']);
export const serviceStatusEnum = pgEnum('service_status', [
  'running', 'stopped', 'deploying', 'failed', 'unknown',
]);
export const gitProviderEnum = pgEnum('git_provider', ['github', 'gitlab', 'gitea', 'bitbucket']);

// ── Projects ───────────────────────────────────────────────
export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  environment: environmentEnum('environment').notNull().default('production'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  orgIdx: index('idx_projects_org').on(table.organizationId),
}));

// ── Services ───────────────────────────────────────────────
export const services = pgTable('services', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  type: serviceTypeEnum('type').notNull().default('application'),
  sourceType: sourceTypeEnum('source_type').notNull(),

  // Git source
  gitUrl: text('git_url'),
  gitBranch: varchar('git_branch', { length: 255 }).default('main'),
  gitProvider: gitProviderEnum('git_provider'),

  // Dockerfile
  dockerfilePath: varchar('dockerfile_path', { length: 500 }).default('Dockerfile'),
  dockerContext: varchar('docker_context', { length: 500 }).default('.'),

  // Compose
  composeFile: text('compose_file'),

  // Image source
  imageName: varchar('image_name', { length: 500 }),
  imageTag: varchar('image_tag', { length: 255 }).default('latest'),

  // Node placement
  buildNodeId: uuid('build_node_id'),  // FK added in relations
  targetNodeId: uuid('target_node_id'), // Legacy single-node — kept for backward compat
  /** Array of node IDs this service should deploy to. Replicas = length. */
  deployNodeIds: jsonb('deploy_node_ids').default([]),

  // Config
  replicas: integer('replicas').notNull().default(1),
  envVars: jsonb('env_vars').default({}),           // encrypted
  ports: jsonb('ports').default([]),
  volumes: jsonb('volumes').default([]),
  healthCheck: jsonb('health_check'),
  deployConfig: jsonb('deploy_config'),
  resourceLimits: jsonb('resource_limits'),
  labels: jsonb('labels').default({}),
  autoDeploy: boolean('auto_deploy').notNull().default(true),

  // Docker Swarm reference
  webhookSecret: varchar('webhook_secret', { length: 255 }),
  swarmServiceId: varchar('swarm_service_id', { length: 100 }),

  // Status
  status: serviceStatusEnum('status').notNull().default('unknown'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  projectIdx: index('idx_services_project').on(table.projectId),
}));

// ── Relations ──────────────────────────────────────────────
export const projectsRelations = relations(projects, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [projects.organizationId],
    references: [organizations.id],
  }),
  services: many(services),
}));

export const servicesRelations = relations(services, ({ one }) => ({
  project: one(projects, {
    fields: [services.projectId],
    references: [projects.id],
  }),
}));
