// ============================================================
// Click-Deploy — Integrations Schema
// ============================================================
import {
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { organizations } from './auth';

// ── GitHub Apps ─────────────────────────────────────────────
// Stores the platform-level GitHub App credentials (Manifest flow)
export const githubApps = pgTable('github_apps', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().unique().references(() => organizations.id, { onDelete: 'cascade' }),
  appId: varchar('app_id', { length: 255 }).notNull(),
  clientId: varchar('client_id', { length: 255 }).notNull(),
  clientSecret: text('client_secret').notNull(),
  webhookSecret: varchar('webhook_secret', { length: 255 }).notNull(),
  privateKey: text('private_key').notNull(), // encrypted
  name: varchar('name', { length: 255 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── GitHub Installations ─────────────────────────────────────
// Stores the actual installation instance generated when users install the App
export const githubInstallations = pgTable('github_installations', {
  id: uuid('id').defaultRandom().primaryKey(),
  githubAppId: uuid('github_app_id').notNull().references(() => githubApps.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull().unique().references(() => organizations.id, { onDelete: 'cascade' }),
  installationId: varchar('installation_id', { length: 255 }).notNull().unique(),
  accountName: varchar('account_name', { length: 255 }).notNull(), // e.g. the GitHub user/org name
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  appIdx: index('idx_gh_inst_app').on(table.githubAppId),
}));

// ── Relations ──────────────────────────────────────────────
export const githubAppsRelations = relations(githubApps, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [githubApps.organizationId],
    references: [organizations.id],
  }),
  installations: many(githubInstallations),
}));

export const githubInstallationsRelations = relations(githubInstallations, ({ one }) => ({
  githubApp: one(githubApps, {
    fields: [githubInstallations.githubAppId],
    references: [githubApps.id],
  }),
  organization: one(organizations, {
    fields: [githubInstallations.organizationId],
    references: [organizations.id],
  }),
}));
