// ============================================================
// Click-Deploy — Notifications & Audit Log Schema
// ============================================================
import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  varchar,
  pgEnum,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { organizations, users } from './auth';

// ── Enums ──────────────────────────────────────────────────
export const notificationTypeEnum = pgEnum('notification_type', [
  'slack', 'discord', 'telegram', 'email', 'webhook',
]);
export const notificationEventEnum = pgEnum('notification_event', [
  'deploy_success', 'deploy_fail', 'service_down', 'service_up',
  'node_offline', 'node_online', 'build_fail', 'certificate_expiring',
]);
export const inAppNotificationLevelEnum = pgEnum('in_app_notification_level', [
  'info', 'success', 'warning', 'error',
]);

// ── Notification Channels ──────────────────────────────────
export const notificationChannels = pgTable('notification_channels', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  type: notificationTypeEnum('type').notNull(),
  config: jsonb('config').notNull().default({}), // encrypted
  enabled: text('enabled').notNull().default('true'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Notification Rules ─────────────────────────────────────
export const notificationRules = pgTable('notification_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  channelId: uuid('channel_id').notNull().references(() => notificationChannels.id, { onDelete: 'cascade' }),
  event: notificationEventEnum('event').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Audit Log ──────────────────────────────────────────────
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: varchar('action', { length: 100 }).notNull(), // e.g., "service.create", "deployment.trigger"
  resourceType: varchar('resource_type', { length: 50 }).notNull(), // e.g., "service", "node", "domain"
  resourceId: uuid('resource_id'),
  metadata: jsonb('metadata').default({}),
  ipAddress: varchar('ip_address', { length: 45 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── In-App Notifications ───────────────────────────────────
export const inAppNotifications = pgTable('in_app_notifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 200 }).notNull(),
  message: text('message').notNull().default(''),
  level: inAppNotificationLevelEnum('level').notNull().default('info'),
  category: varchar('category', { length: 50 }).notNull().default('system'),
  resourceId: uuid('resource_id'),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  orgIdx: index('in_app_notif_org_idx').on(table.organizationId),
  userIdx: index('in_app_notif_user_idx').on(table.userId),
  readIdx: index('in_app_notif_read_idx').on(table.readAt),
}));

// ── UI Events (Supabase Realtime broadcast table) ──────────
export const uiEvents = pgTable('ui_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventType: text('event_type').notNull().default('refresh'),
  payload: jsonb('payload').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Relations ──────────────────────────────────────────────
export const notificationChannelsRelations = relations(notificationChannels, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [notificationChannels.organizationId],
    references: [organizations.id],
  }),
  rules: many(notificationRules),
}));

export const notificationRulesRelations = relations(notificationRules, ({ one }) => ({
  channel: one(notificationChannels, {
    fields: [notificationRules.channelId],
    references: [notificationChannels.id],
  }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  organization: one(organizations, {
    fields: [auditLogs.organizationId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [auditLogs.userId],
    references: [users.id],
  }),
}));

export const inAppNotificationsRelations = relations(inAppNotifications, ({ one }) => ({
  organization: one(organizations, {
    fields: [inAppNotifications.organizationId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [inAppNotifications.userId],
    references: [users.id],
  }),
}));
