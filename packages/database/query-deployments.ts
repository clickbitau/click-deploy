import postgres from 'postgres';
async function run() {
  const sql = postgres(process.env.DATABASE_URL!);
  try {
    const res = await sql`SELECT image_name, commit_sha, deploy_status, created_at FROM deployments WHERE service_id = '0d1c98cf-1338-4afe-afee-022e806d52b3' ORDER BY created_at DESC LIMIT 15;`;
    console.log("DEPLOYMENTS:");
    console.table(res);
  } catch(e) {
    console.error('Query failed:', e);
  }
  process.exit(0);
}
run();
