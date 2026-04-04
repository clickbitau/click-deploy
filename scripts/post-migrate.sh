#!/bin/sh
# ============================================================
# Click-Deploy — Post-Migration Setup
# ============================================================
# Runs after drizzle-kit push to configure Supabase features
# that can't be expressed in Drizzle schema (realtime, triggers).
# Safe to run on non-Supabase databases — errors are non-fatal.
# ============================================================
set -e

echo "📦 Running post-migration setup..."

# Use the postgres driver already installed in the database package
node -e "
  const postgres = require('postgres');
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });

  (async () => {
    // 1. Add tables to supabase_realtime publication (idempotent)
    const tables = [
      'in_app_notifications',
      'ui_events',
      'deployments',
      'nodes',
      'services',
    ];

    for (const table of tables) {
      try {
        await sql.unsafe('ALTER PUBLICATION supabase_realtime ADD TABLE public.' + table);
        console.log('  ✓ Added ' + table + ' to realtime');
      } catch (e) {
        if (e.message.includes('already member')) {
          console.log('  · ' + table + ' already in realtime');
        } else if (e.message.includes('does not exist')) {
          console.log('  · No supabase_realtime publication (non-Supabase DB)');
          break;
        } else {
          console.warn('  ⚠ ' + table + ': ' + e.message);
        }
      }
    }

    // 2. Ensure broadcast_ui_event function has correct schema
    try {
      await sql.unsafe(\`
        CREATE OR REPLACE FUNCTION public.broadcast_ui_event()
        RETURNS trigger
        LANGUAGE plpgsql
        SET search_path = public
        AS \\\$func\\\$
        BEGIN
          INSERT INTO public.ui_events (event_type, payload)
          VALUES (TG_OP, jsonb_build_object('tbl', TG_TABLE_NAME));
          RETURN NEW;
        END;
        \\\$func\\\$
      \`);
      console.log('  ✓ broadcast_ui_event function configured');
    } catch (e) {
      console.warn('  ⚠ broadcast_ui_event: ' + e.message);
    }

    await sql.end();
    console.log('✅ Post-migration setup complete');
  })().catch(e => {
    console.error('Post-migration setup warning:', e.message);
    sql.end().catch(() => {});
    process.exit(0); // Non-fatal — don't block startup
  });
"
