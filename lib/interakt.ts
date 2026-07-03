// Interakt WhatsApp sender. Uses node:https (not fetch) — fetch/undici OOMs under CloudLinux.
// Templates must be pre-approved in the Interakt dashboard; we send by template name + bodyValues.
import https from "node:https";

const API_KEY = process.env.INTERAKT_API_KEY;
const BASE = process.env.INTERAKT_BASE_URL || "https://api.interakt.ai";
const DEFAULT_CC = process.env.INTERAKT_COUNTRY_CODE || "+91";
const LANG = process.env.INTERAKT_TEMPLATE_LANG || "en";

export const interaktConfigured = Boolean(API_KEY);

// Take the first number out of a "9876543210 / 9876543211" style field and split into cc + 10 digits.
export function normalizePhone(raw?: string | null): { countryCode: string; phoneNumber: string } | null {
  if (!raw) return null;
  const first = String(raw).split(/[/,;]/)[0];
  const digits = first.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 12 && digits.startsWith("91")) return { countryCode: "+91", phoneNumber: digits.slice(2) };
  if (digits.length === 11 && digits.startsWith("0")) return { countryCode: DEFAULT_CC, phoneNumber: digits.slice(1) };
  if (digits.length >= 10) return { countryCode: DEFAULT_CC, phoneNumber: digits.slice(-10) };
  return null;
}

export interface SendResult { ok: boolean; error?: string; id?: string }

export async function sendTemplate(opts: { phone?: string | null; template: string; bodyValues: (string | number | null | undefined)[]; languageCode?: string }): Promise<SendResult> {
  if (!API_KEY) return { ok: false, error: "INTERAKT_API_KEY not set" };
  if (!opts.template) return { ok: false, error: "template name missing" };
  const p = normalizePhone(opts.phone);
  if (!p) return { ok: false, error: `invalid phone: ${opts.phone ?? "(none)"}` };

  const payload = JSON.stringify({
    countryCode: p.countryCode,
    phoneNumber: p.phoneNumber,
    type: "Template",
    template: {
      name: opts.template,
      languageCode: opts.languageCode || LANG,
      // Meta rejects newlines/tabs in variables — flatten whitespace defensively.
      bodyValues: opts.bodyValues.map((v) => String(v ?? "").replace(/\s+/g, " ").trim()),
    },
  });

  return new Promise((resolve) => {
    const u = new URL("/v1/public/message/", BASE);
    const req = https.request(
      {
        hostname: u.hostname,
        port: 443,
        path: u.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${API_KEY}`,
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          const okStatus = (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300;
          try {
            const j = JSON.parse(body);
            // Interakt returns { result: true, id, message }.
            if (okStatus && j.result !== false) resolve({ ok: true, id: j.id });
            else resolve({ ok: false, error: (j.message || body).toString().slice(0, 300) });
          } catch {
            resolve({ ok: okStatus, error: okStatus ? undefined : body.slice(0, 300) });
          }
        });
      },
    );
    req.on("error", (e) => resolve({ ok: false, error: e.message }));
    req.write(payload);
    req.end();
  });
}
