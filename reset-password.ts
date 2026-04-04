import { db } from "./packages/database/src";
import { accounts } from "./packages/database/src/schema/auth";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

async function main() {
  const accs = await db.query.accounts.findMany({});
  for (const a of accs) {
    if (a.password) {
      console.log(`Resetting password for account ${a.id} (testing)...`);
      const hashed = await bcrypt.hash("password123", 10);
      await db.update(accounts).set({ password: hashed }).where(eq(accounts.id, a.id));
      console.log("Successfully reset all passwords to: password123");
    }
  }
}
main().catch(console.error).then(() => process.exit(0));
