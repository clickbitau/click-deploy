// ============================================================
// Click-Deploy — Deployment Schema
// ============================================================
import {
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
  integer,
  pgEnum,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { services } from './projects';
import { nodes } from './nodes';

// ── Enums ──────────────────────────────────────────────────
export const buildStatusEnum = pgEnum('build_status', [
  'pending', 'building', 'built', 'failed', 'cancelled',
]);
export const deployStatusEnum = pgEnum('deploy_status', [
  'pending', 'building', 'built', 'deploying', 'running', 'failed', 'rolled_back', 'cancelled',
]);
export const deployTriggerEnum = pgEnum('deploy_trigger', [
  'webhook', 'manual', 'rollback', 'schedule', 'api',
]);

// ── Deployments ────────────────────────────────────────────
export const deployments = pgTable('deployments', {
  id: uuid('id').defaultRandom().primaryKey(),
  serviceId: uuid('service_id').notNull().references(() => services.id, { onDelete: 'cascade' }),
  triggeredBy: deployTriggerEnum('triggered_by').notNull().default('manual'),

  // Git info
  commitSha: varchar('commit_sha', { length: 40 }),
  commitMessage: text('commit_message'),
  branch: varchar('branch', { length: 255 }),

  // Status tracking
  buildStatus: buildStatusEnum('build_status').notNull().default('pending'),
  deployStatus: deployStatusEnum('deploy_status').notNull().default('pending'),

  // Node placement
  buildNodeId: uuid('build_node_id').references(() => nodes.id, { onDelete: 'set null' }),
  deployNodeId: uuid('deploy_node_id').references(() => nodes.id, { onDelete: 'set null' }),

  // Image
  imageDigest: varchar('image_digest', { length: 100 }),
  imageName: varchar('image_name', { length: 500 }),

  // Timing
  buildDurationMs: integer('build_duration_ms'),
  deployDurationMs: integer('deploy_duration_ms'),

  // Error tracking
  errorMessage: text('error_message'),

  // Logs stored as text (can move to S3 for scale)
  buildLogs: text('build_logs'),
  deployLogs: text('deploy_logs'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => ({
  serviceIdx: index('idx_deploy_service').on(table.serviceId),
  buildNodeIdx: index('idx_deploy_build_node').on(table.buildNodeId),
  deployNodeIdx: index('idx_deploy_deploy_node').on(table.deployNodeId),
}));

// ── Relations ──────────────────────────────────────────────
export const deploymentsRelations = relations(deployments, ({ one }) => ({
  service: one(services, {
    fields: [deployments.serviceId],
    references: [services.id],
  }),
  buildNode: one(nodes, {
    fields: [deployments.buildNodeId],
    references: [nodes.id],
    relationName: 'buildNode',
  }),
  deployNode: one(nodes, {
    fields: [deployments.deployNodeId],
    references: [nodes.id],
    relationName: 'deployNode',
  }),
}));
