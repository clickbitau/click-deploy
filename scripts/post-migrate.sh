#!/bin/sh
# ============================================================
# Click-Deploy — Post-Migration Setup
# ============================================================
# Runs after drizzle-kit push to configure database features
# that can't be expressed in Drizzle schema:
#   - Row-Level Security (RLS) on all tables
#   - Service-role-only access policies
#   - Foreign key indexes for performance
#   - Supabase Realtime publication (if applicable)
#   - UI broadcast trigger function
#
# Safe to run repeatedly — all operations are idempotent.
# Safe on non-Supabase databases — errors are non-fatal.
# ============================================================

echo "📦 Running post-migration setup..."

node -e '
const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

(async () => {
  // ── 1. Enable RLS on all public tables ────────────────────
  console.log("\n── Enabling Row-Level Security ──");
  const tables = [
    "accounts", "organizations", "sessions", "users", "verifications",
    "projects", "services", "deployments", "nodes", "ssh_keys",
    "domains", "registries", "tunnel_routes", "tunnels",
    "audit_logs", "in_app_notifications", "notification_channels",
    "notification_rules", "ui_events", "github_apps", "github_installations"
  ];

  for (const t of tables) {
    try {
      await sql.unsafe("ALTER TABLE public." + t + " ENABLE ROW LEVEL SECURITY");
      console.log("  ✓ RLS: " + t);
    } catch (e) {
      if (e.message.includes("does not exist")) {
        // Table does not exist yet — skip silently
      } else {
        console.log("  · " + t + ": " + e.message);
      }
    }
  }

  // ── 2. Add service-role-only policies ─────────────────────
  console.log("\n── Adding service-role-only policies ──");
  for (const t of tables) {
    const p = "service_role_only_" + t;
    try {
      await sql.unsafe("DROP POLICY IF EXISTS \"" + p + "\" ON public." + t);
      await sql.unsafe("CREATE POLICY \"" + p + "\" ON public." + t + " FOR ALL TO service_role USING (true) WITH CHECK (true)");
      console.log("  ✓ policy: " + t);
    } catch (e) {
      if (!e.message.includes("does not exist")) {
        console.log("  · " + t + ": " + e.message);
      }
    }
  }

  // ── 3. Create FK indexes for performance ──────────────────
  console.log("\n── Creating FK indexes ──");
  var indexes = [
    ["idx_accounts_user_id", "accounts", "user_id"],
    ["idx_audit_logs_org_id", "audit_logs", "organization_id"],
    ["idx_audit_logs_user_id", "audit_logs", "user_id"],
    ["idx_deploy_build_node", "deployments", "build_node_id"],
    ["idx_deploy_deploy_node", "deployments", "deploy_node_id"],
    ["idx_deploy_service", "deployments", "service_id"],
    ["idx_domains_service", "domains", "service_id"],
    ["idx_domains_tunnel", "domains", "tunnel_id"],
    ["idx_gh_inst_app", "github_installations", "github_app_id"],
    ["idx_nodes_org", "nodes", "organization_id"],
    ["idx_nodes_ssh_key", "nodes", "ssh_key_id"],
    ["idx_notif_ch_org", "notification_channels", "organization_id"],
    ["idx_notif_rules_ch", "notification_rules", "channel_id"],
    ["idx_projects_org", "projects", "organization_id"],
    ["idx_registries_org", "registries", "organization_id"],
    ["idx_services_project", "services", "project_id"],
    ["idx_sessions_user", "sessions", "user_id"],
    ["idx_ssh_keys_org", "ssh_keys", "organization_id"],
    ["idx_tunnel_routes_tunnel", "tunnel_routes", "tunnel_id"],
    ["idx_tunnels_node", "tunnels", "node_id"],
    ["idx_tunnels_org", "tunnels", "organization_id"],
    ["idx_users_org", "users", "organization_id"]
  ];

  for (const [name, table, col] of indexes) {
    try {
      await sql.unsafe("CREATE INDEX IF NOT EXISTS " + name + " ON public." + table + " USING btree (" + col + ")");
      console.log("  ✓ " + name);
    } catch (e) {
      if (!e.message.includes("does not exist")) {
        console.log("  · " + name + ": " + e.message);
      }
    }
  }

  // ── 4. Create/update broadcast_ui_event trigger function ──
  console.log("\n── Configuring broadcast trigger ──");
  try {
    await sql.unsafe(
      "CREATE OR REPLACE FUNCTION public.broadcast_ui_event() " +
      "RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER " +
      "SET search_path = public AS " +
      "$fn$BEGIN INSERT INTO public.ui_events (event_type, payload) " +
      "VALUES (TG_OP, jsonb_build_object('table', TG_TABLE_NAME)); " +
      "RETURN NULL; END;$fn$"
    );
    console.log("  ✓ broadcast_ui_event function created");
  } catch (e) {
    console.log("  · broadcast_ui_event: " + e.message);
  }

  // ── 5. Create triggers on key tables ──────────────────────
  var triggerTables = ["deployments", "services", "nodes"];
  for (const t of triggerTables) {
    var trgName = "trg_broadcast_" + t;
    try {
      await sql.unsafe("DROP TRIGGER IF EXISTS " + trgName + " ON public." + t);
      await sql.unsafe(
        "CREATE TRIGGER " + trgName + " AFTER INSERT OR UPDATE OR DELETE ON public." + t +
        " FOR EACH STATEMENT EXECUTE FUNCTION broadcast_ui_event()"
      );
      console.log("  ✓ trigger: " + trgName);
    } catch (e) {
      console.log("  · " + trgName + ": " + e.message);
    }
  }

  // ── 6. Supabase Realtime publication (optional) ───────────
  console.log("\n── Supabase Realtime ──");
  var realtimeTables = ["in_app_notifications", "ui_events", "deployments", "nodes", "services"];
  for (const t of realtimeTables) {
    try {
      await sql.unsafe("ALTER PUBLICATION supabase_realtime ADD TABLE public." + t);
      console.log("  ✓ " + t + " added to realtime");
    } catch (e) {
      if (e.message.includes("already member")) {
        console.log("  · " + t + " already in realtime");
      } else if (e.message.includes("does not exist")) {
        console.log("  · No supabase_realtime publication (non-Supabase DB) — skipping");
        break;
      } else {
        console.log("  · " + t + ": " + e.message);
      }
    }
  }

  await sql.end();
  console.log("\n✅ Post-migration setup complete");
})().catch(e => {
  console.error("Post-migration setup warning:", e.message);
  sql.end().catch(() => {});
  process.exit(0); // Non-fatal — do not block startup
});
'
