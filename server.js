// Passenger (cPanel) entry point. Boots Next.js in production and hands every
// request to it. Passenger sets PORT; we fall back to 3000 for manual runs.

// Load env from a .env file in the app dir. cPanel's "Environment variables" UI does not
// reliably inject into the process on this host, so a plain file is the source of truth.
// (Does not override anything cPanel *did* manage to set.)
const fs = require("fs");
const path = require("path");
for (const f of [".env.local", ".env.production", ".env"]) {
  try {
    const txt = fs.readFileSync(path.join(__dirname, f), "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* file not present — fine */ }
}

const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");

const app = next({ dev: false });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    createServer((req, res) => handle(req, res, parse(req.url, true))).listen(
      process.env.PORT || 3000
    );
  })
  .catch((err) => {
    console.error("[server] failed to start:", err);
    process.exit(1);
  });
