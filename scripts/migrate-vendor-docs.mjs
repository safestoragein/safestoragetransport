// One-off: pull existing vendor documents (currently external URLs in Supabase Storage /
// Vercel Blob) INTO MySQL as blobs, then repoint the vendor URL at the in-app serving route.
//
//   node scripts/migrate-vendor-docs.mjs
//
// Run it AFTER migrate-vendors (so the vendor rows + their *_url values exist in MySQL).
// Reads MYSQL_* from env/.env.local. Safe to re-run (skips docs already in MySQL / already
// repointed). Only external http(s) URLs are fetched; already-migrated /safestorage-transport
// URLs are left alone.
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";
import https from "node:https";
import http from "node:http";

// Plain http(s) GET (avoids Node's fetch/undici WASM parser, which OOMs under CloudLinux).
function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "http:" ? http : https;
    const req = lib.request(
      { hostname: u.hostname, port: u.port || (u.protocol === "http:" ? 80 : 443), path: u.pathname + u.search, method: "GET", headers },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode || 0, buffer: Buffer.concat(chunks), headers: res.headers }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

try {
  const txt = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of txt.split("\n")) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* rely on real env */ }

const { MYSQL_URL, MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE, MYSQL_SSL } = process.env;
if (!MYSQL_URL && !(MYSQL_HOST && MYSQL_USER && MYSQL_DATABASE)) {
  console.error("Missing MySQL config: set MYSQL_URL or MYSQL_HOST/MYSQL_USER/MYSQL_DATABASE.");
  process.exit(1);
}
const PFX = process.env.MYSQL_TABLE_PREFIX ?? "sst_";
const BASE_PATH = "/safestorage-transport";

const conn = MYSQL_URL
  ? await mysql.createConnection(MYSQL_URL)
  : await mysql.createConnection({
      host: MYSQL_HOST, port: MYSQL_PORT ? Number(MYSQL_PORT) : 3306,
      user: MYSQL_USER, password: MYSQL_PASSWORD, database: MYSQL_DATABASE,
      ssl: MYSQL_SSL === "true" ? { rejectUnauthorized: true } : MYSQL_SSL === "insecure" ? { rejectUnauthorized: false } : undefined,
    });

const KINDS = [
  { kind: "service_agreement", col: "service_agreement_url" },
  { kind: "gst", col: "gst_document_url" },
];

let migrated = 0, skipped = 0, failed = 0;
try {
  const [vendors] = await conn.query(`SELECT id, service_agreement_url, gst_document_url FROM \`${PFX}vendors\``);
  for (const v of vendors) {
    for (const { kind, col } of KINDS) {
      const url = v[col];
      if (!url || !/^https?:\/\//i.test(url)) { continue; } // empty or already an in-app path
      try {
        const res = await httpGet(url);
        if (res.status < 200 || res.status >= 300) { console.warn(`  ! ${v.id} ${kind}: HTTP ${res.status}`); failed++; continue; }
        const buf = res.buffer;
        const ct = res.headers["content-type"] || "application/octet-stream";
        const fname = (url.split("/").pop() || kind).split("?")[0].replace(/[^a-zA-Z0-9._-]/g, "_");
        await conn.execute(
          `INSERT INTO \`${PFX}vendor_documents\` (vendor_id, kind, filename, content_type, byte_size, data)
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE filename=VALUES(filename), content_type=VALUES(content_type), byte_size=VALUES(byte_size), data=VALUES(data)`,
          [v.id, kind, fname, ct, buf.length, buf],
        );
        const newUrl = `${BASE_PATH}/api/vendors/doc/${v.id}/${kind}?v=${Date.now()}`;
        await conn.execute(`UPDATE \`${PFX}vendors\` SET \`${col}\` = ? WHERE id = ?`, [newUrl, v.id]);
        console.log(`  ✓ ${v.id} ${kind} (${buf.length} bytes)`);
        migrated++;
      } catch (e) {
        console.warn(`  ! ${v.id} ${kind}: ${e.message}`); failed++;
      }
    }
  }
  console.log(`\nDone. migrated=${migrated} skipped=${skipped} failed=${failed}`);
} catch (e) {
  console.error("Failed:", e.message); process.exitCode = 1;
} finally {
  await conn.end();
}
