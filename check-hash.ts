import { db } from "./packages/database/src";
import { accounts } from "./packages/database/src/schema/auth";
import bcrypt from "bcryptjs";

async function main() {
  const accs = await db.query.accounts.findMany({});
  for (const a of accs) {
    if (a.password) {
      console.log("Account", a.id, "hash:", a.password.slice(0, 15) + "...");
      console.log("Is bcrypt format?", a.password.startsWith("$2"));
    }
  }
}
main().catch(console.error).then(() => process.exit(0));
