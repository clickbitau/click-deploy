import postgres from 'postgres';
async function run() {
  const sql = postgres(process.env.DATABASE_URL!);
  try {
    const res = await sql`SELECT * FROM github_apps;`;
    console.log("APPS:", res);
  } catch(e) {
    console.error('Query failed:', e);
  }
  process.exit(0);
}
run();
