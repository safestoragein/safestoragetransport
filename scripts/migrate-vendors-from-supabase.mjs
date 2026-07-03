// One-off: copy the vendor master from the old Supabase table into MySQL.
//
//   node scripts/migrate-vendors-from-supabase.mjs
//
// Reads both sets of creds from .env.local (or the real env):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY          (source)
//   MYSQL_URL  OR  MYSQL_HOST/PORT/USER/PASSWORD/DATABASE   (target)
//
// It pulls every row from Supabase `safestorage.vendors` via the REST API and
// upserts into MySQL `vendors`, keyed on (city, name, vehicle_type) — so it's
// safe to re-run and it merges with the rows the setup script already seeded.
// Add --truncate to wipe the MySQL vendors table first for an exact 1:1 copy.
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";

// ── load .env.local (simple parser; doesn't override already-set env) ────────
try {
  const txt = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of txt.split("\n")) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* rely on real env */ }

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const { MYSQL_URL, MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE, MYSQL_SSL } = process.env;
const TRUNCATE = process.argv.includes("--truncate");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (source).");
  process.exit(1);
}
if (!MYSQL_URL && !(MYSQL_HOST && MYSQL_USER && MYSQL_DATABASE)) {
  console.error("Missing MySQL config: set MYSQL_URL or MYSQL_HOST/MYSQL_USER/MYSQL_DATABASE (target).");
  process.exit(1);
}

// Columns copied across (both tables share these names). id is preserved so the
// UUIDs stay stable; created_at/updated_at are left to MySQL.
const COLS = [
  "id", "city", "name", "vehicle_type", "pallet_capacity", "effective_capacity",
  "tier", "daily_price", "pricing_note", "per_transaction",
  "starting_point", "starting_lat", "starting_lng", "is_intercity_vendor",
  "system_team_id", "system_team_no", "vehicle_no", "vehicle_name",
  "driver_name", "driver_contact", "supervisor_name", "supervisor_contact",
  "packer_names", "team_working_status", "security_deposit",
  "service_agreement_url", "gst_document_url", "notes", "priority_group",
  "supervisors", "billing_cycle", "remarks", "active", "source",
];

function enc(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === "object") return JSON.stringify(v); // supervisors (jsonb)
  if (typeof v === "boolean") return v ? 1 : 0;
  return v;
}

// ── 1) read from Supabase (PostgREST); Accept-Profile selects the schema ─────
const url = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/vendors?select=*&limit=10000`;
const res = await fetch(url, {
  headers: {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Accept-Profile": "safestorage",
  },
});
if (!res.ok) {
  console.error(`Supabase read failed: HTTP ${res.status} — ${await res.text()}`);
  process.exit(1);
}
const rows = await res.json();
console.log(`Fetched ${rows.length} vendors from Supabase.`);
if (!rows.length) { console.log("Nothing to migrate."); process.exit(0); }

// ── 2) write to MySQL ────────────────────────────────────────────────────────
const conn = MYSQL_URL
  ? await mysql.createConnection(MYSQL_URL)
  : await mysql.createConnection({
      host: MYSQL_HOST,
      port: MYSQL_PORT ? Number(MYSQL_PORT) : 3306,
      user: MYSQL_USER,
      password: MYSQL_PASSWORD,
      database: MYSQL_DATABASE,
      ssl: MYSQL_SSL === "true" ? { rejectUnauthorized: true } : MYSQL_SSL === "insecure" ? { rejectUnauthorized: false } : undefined,
    });

const TABLE = (process.env.MYSQL_TABLE_PREFIX ?? "sst_") + "vendors";

try {
  if (TRUNCATE) {
    // FK-safe: schedule_assignments references vendors only by a loose vendor_id
    // (no FK), so a plain DELETE is fine.
    await conn.query(`DELETE FROM \`${TABLE}\``);
    console.log("Cleared existing MySQL vendors (--truncate).");
  }

  const cols = COLS.map((c) => `\`${c}\``).join(", ");
  const placeholders = "(" + COLS.map(() => "?").join(", ") + ")";
  const updates = COLS.filter((c) => c !== "id").map((c) => `\`${c}\` = VALUES(\`${c}\`)`).join(", ");
  const sql = `INSERT INTO \`${TABLE}\` (${cols}) VALUES ${rows.map(() => placeholders).join(", ")}
               ON DUPLICATE KEY UPDATE ${updates}`;
  const params = rows.flatMap((r) => COLS.map((c) => enc(r[c])));

  const [result] = await conn.query(sql, params);
  console.log(`✅ Migrated ${rows.length} vendors into MySQL (affected rows: ${result.affectedRows}).`);
} catch (e) {
  console.error("Migration failed:", e.message);
  process.exitCode = 1;
} finally {
  await conn.end();
}
