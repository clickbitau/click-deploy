import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });

async function run() {
  const sql = postgres(process.env.DATABASE_URL!);
  
  console.log('Adding webhook_secret to services table...');
  try {
    await sql`ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "webhook_secret" varchar(255);`;
    console.log('Migration successful.');
  } catch(e) {
    console.error('Migration failed:', e);
  }
  
  process.exit(0);
}
run();
