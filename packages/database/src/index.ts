// ============================================================
// Click-Deploy — Database Client
// ============================================================
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index';

const connectionString = process.env.DATABASE_URL || (process.env.npm_lifecycle_event === 'build' ? 'postgresql://placeholder@localhost/placeholder' : undefined) || (process.env.CI ? 'postgresql://placeholder@localhost/placeholder' : undefined);

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set');
}

// Connection for queries
// - max: 3 keeps total connections across 3 replicas ≤ 9 (within Supabase pool limits)
// - prepare: false is REQUIRED for Supabase Transaction mode (port 6543) — PgBouncer
//   doesn't support named prepared statements since connections are shared
const queryClient = postgres(connectionString, {
  max: 3,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
});

// Drizzle instance with full schema
export const db = drizzle(queryClient, { schema });

// Export type helpers
export type Database = typeof db;

// Re-export schema and drizzle utilities
export * from './schema/index';
export { eq, ne, gt, gte, lt, lte, like, ilike, and, or, not, inArray, notInArray, isNull, isNotNull, sql, desc, asc, count } from 'drizzle-orm';
