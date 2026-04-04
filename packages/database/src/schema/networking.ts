// ============================================================
// Click-Deploy — Domain, Tunnel & Registry Schema
// ============================================================
import {
  pgTable,
  text,
  timestamp,
  boolean,
  jsonb,
  uuid,
  varchar,
  pgEnum,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { organizations } from './auth';
import { services } from './projects';
import { nodes } from './nodes';

// ── Enums ──────────────────────────────────────────────────
export const sslProviderEnum = pgEnum('ssl_provider', ['letsencrypt', 'cloudflare', 'custom', 'none']);
export const tunnelStatusEnum = pgEnum('tunnel_status', ['active', 'inactive', 'error']);
export const registryTypeEnum = pgEnum('registry_type', ['dockerhub', 'ghcr', 'ecr', 'self_hosted', 'custom']);

// ── Domains ────────────────────────────────────────────────
export const domains = pgTable('domains', {
  id: uuid('id').defaultRandom().primaryKey(),
  serviceId: uuid('service_id').notNull().references(() => services.id, { onDelete: 'cascade' }),
  hostname: varchar('hostname', { length: 255 }).notNull(),
  sslEnabled: boolean('ssl_enabled').notNull().default(true),
  sslProvider: sslProviderEnum('ssl_provider').default('letsencrypt'),
  certificate: text('certificate'),       // encrypted
  privateKey: text('private_key_cert'),    // encrypted (renamed to avoid conflict)
  tunnelId: uuid('tunnel_id').references(() => tunnels.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  serviceIdx: index('idx_domains_service').on(table.serviceId),
  tunnelIdx: index('idx_domains_tunnel').on(table.tunnelId),
}));

// ── Tunnels ────────────────────────────────────────────────
export const tunnels = pgTable('tunnels', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  cloudflareTunnelId: varchar('cloudflare_tunnel_id', { length: 100 }),
  cloudflareAccountId: varchar('cloudflare_account_id', { length: 100 }),
  token: text('token'),                   // encrypted
  status: tunnelStatusEnum('status').default('inactive'),
  nodeId: uuid('node_id').references(() => nodes.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  orgIdx: index('idx_tunnels_org').on(table.organizationId),
  nodeIdx: index('idx_tunnels_node').on(table.nodeId),
}));

// ── Tunnel Routes ──────────────────────────────────────────
export const tunnelRoutes = pgTable('tunnel_routes', {
  id: uuid('id').defaultRandom().primaryKey(),
  tunnelId: uuid('tunnel_id').notNull().references(() => tunnels.id, { onDelete: 'cascade' }),
  hostname: varchar('hostname', { length: 255 }).notNull(),
  service: varchar('service', { length: 500 }).notNull(), // e.g., "http://traefik:80"
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  tunnelIdx: index('idx_tunnel_routes_tunnel').on(table.tunnelId),
}));

// ── Registries ─────────────────────────────────────────────
export const registries = pgTable('registries', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  type: registryTypeEnum('type').notNull(),
  url: varchar('url', { length: 500 }).notNull(),
  username: text('username'),              // encrypted
  password: text('password'),              // encrypted
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  orgIdx: index('idx_registries_org').on(table.organizationId),
}));

// ── Relations ──────────────────────────────────────────────
export const domainsRelations = relations(domains, ({ one }) => ({
  service: one(services, {
    fields: [domains.serviceId],
    references: [services.id],
  }),
  tunnel: one(tunnels, {
    fields: [domains.tunnelId],
    references: [tunnels.id],
  }),
}));

export const tunnelsRelations = relations(tunnels, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [tunnels.organizationId],
    references: [organizations.id],
  }),
  node: one(nodes, {
    fields: [tunnels.nodeId],
    references: [nodes.id],
  }),
  routes: many(tunnelRoutes),
  domains: many(domains),
}));

export const tunnelRoutesRelations = relations(tunnelRoutes, ({ one }) => ({
  tunnel: one(tunnels, {
    fields: [tunnelRoutes.tunnelId],
    references: [tunnels.id],
  }),
}));

export const registriesRelations = relations(registries, ({ one }) => ({
  organization: one(organizations, {
    fields: [registries.organizationId],
    references: [organizations.id],
  }),
}));
