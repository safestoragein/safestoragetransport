// Create (or update) a Transport-module login.
//   node scripts/create-transport-user.mjs <email> <password> "<Full Name>" [role]
// Reads MYSQL_* from .env.local (or the real env). Passwords are scrypt-hashed with the SAME
// scheme as lib/auth.ts so the app can verify them.
import mysql from "mysql2/promise";
import { scryptSync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

// load .env.local (simple parser; doesn't override already-set env)
try {
  const txt = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of txt.split("\n")) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* no .env.local — rely on real env */ }

const [email, password, name, role = "admin"] = process.argv.slice(2);
if (!email || !password || !name) {
  console.error('Usage: node scripts/create-transport-user.mjs <email> <password> "<Full Name>" [role]');
  process.exit(1);
}

const { MYSQL_URL, MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE, MYSQL_SSL } = process.env;
if (!MYSQL_URL && !(MYSQL_HOST && MYSQL_USER && MYSQL_DATABASE)) {
  console.error("Missing MySQL config: set MYSQL_URL or MYSQL_HOST/MYSQL_USER/MYSQL_DATABASE (check .env.local).");
  process.exit(1);
}

const hashPassword = (pw) => {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(pw, salt, 64).toString("hex")}`;
};

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

try {
  await conn.execute(
    `INSERT INTO transport_users (email, name, role, active, password_hash)
     VALUES (?, ?, ?, 1, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), role = VALUES(role), active = 1, password_hash = VALUES(password_hash)`,
    [email, name, role, hashPassword(password)],
  );
  const [rows] = await conn.execute(
    "SELECT id, email, name, role, active FROM transport_users WHERE email = ?",
    [email],
  );
  console.log("✅ Transport user ready:", rows[0]);
} catch (e) {
  console.error("Failed:", e.message);
  process.exitCode = 1;
} finally {
  await conn.end();
}
