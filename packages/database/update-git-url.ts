import postgres from 'postgres';
async function run() {
  const sql = postgres(process.env.DATABASE_URL!);
  try {
    const res = await sql`UPDATE services SET git_url = 'https://github.com/clickbitau/dkathel.git' WHERE id = '0d1c98cf-1338-4afe-afee-022e806d52b3' RETURNING *;`;
    console.log("UPDATED:");
    console.table(res);
  } catch(e) {
    console.error('Query failed:', e);
  }
  process.exit(0);
}
run();
