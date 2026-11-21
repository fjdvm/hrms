import nextEnv from "@next/env";
import pg from "pg";
import { deliverAuditEvents } from "../lib/audit.ts";

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--deliver")) {
  throw new Error("Usage: node scripts/recover-audit-outbox.mjs [--deliver]");
}
nextEnv.loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const deliver = args[0] === "--deliver";
if (deliver && (!process.env.API_GATEWAY_URL || !process.env.API_GATEWAY_KEY)) {
  throw new Error("API_GATEWAY_URL and API_GATEWAY_KEY are required for delivery");
}
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
async function count() {
  await client.query("BEGIN READ ONLY");
  try {
    const { rows } = await client.query(`SELECT count(*)::int AS remaining,
      count(*) FILTER (WHERE attempts > 0)::int AS attempted FROM public.hrms_audit_outbox`);
    console.log(JSON.stringify({ checked_at: new Date().toISOString(), ...rows[0] }));
    return rows[0].remaining;
  } finally {
    await client.query("ROLLBACK");
  }
}
try {
  await client.connect();
  const remaining = await count();
  if (deliver && remaining > 0) {
    await deliverAuditEvents(client);
    if (await count()) process.exitCode = 1;
  }
} catch {
  console.error("Audit outbox recovery failed; inspect configuration and retry. Credentials omitted.");
  process.exitCode = 1;
} finally {
  await client.end();
}
