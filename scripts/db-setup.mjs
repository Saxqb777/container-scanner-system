// Creates the tables. Run once: DATABASE_URL=... npm run db:setup
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
const statements = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8")
  .split(/;\s*$/m)
  .map((s) => s.replace(/^--.*$/gm, "").trim())
  .filter(Boolean);
for (const s of statements) await sql.query(s);
console.log(`Applied ${statements.length} statements`);
