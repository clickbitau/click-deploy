// ============================================================
// Click-Deploy — Database Client
// ============================================================
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set');
}

// Connection for queries
const queryClient = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

// Drizzle instance with full schema
export const db = drizzle(queryClient, { schema });

// Export type helpers
export type Database = typeof db;

// Re-export schema and drizzle utilities
export * from './schema/index';
export { eq, ne, gt, gte, lt, lte, like, ilike, and, or, not, inArray, notInArray, isNull, isNotNull, sql, desc, asc, count } from 'drizzle-orm';
