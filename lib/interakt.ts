// Interakt WhatsApp sender. Uses node:https (not fetch) — fetch/undici OOMs under CloudLinux.
// Templates must be pre-approved in the Interakt dashboard; we send by template name + bodyValues.
import https from "node:https";

const API_KEY = process.env.INTERAKT_API_KEY;
const BASE = process.env.INTERAKT_BASE_URL || "https://api.interakt.ai";
const DEFAULT_CC = process.env.INTERAKT_COUNTRY_CODE || "+91";
const LANG = process.env.INTERAKT_TEMPLATE_LANG || "en";

export const interaktConfigured = Boolean(API_KEY);

// Take the first number out of a "9876543210 / 9876543211" style field and split into cc + 10 digits.
// A contact can hold several numbers ("9876543210 / 9123456789"). Try each and PREFER a valid
// Indian mobile (10 digits starting 6-9) — WhatsApp/Interakt rejects landlines/invalid numbers
// with "Phone Number & Country Code provided is invalid". Falls back to the first well-formed
// 10-digit number if none is a clear mobile.
function toTenDigits(candidate: string): string | null {
  const digits = candidate.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  if (digits.length >= 10) return digits.slice(-10);
  return null;
}

export function normalizePhone(raw?: string | null): { countryCode: string; phoneNumber: string } | null {
  if (!raw) return null;
  let fallback: { countryCode: string; phoneNumber: string } | null = null;
  for (const part of String(raw).split(/[/,;&]+/)) {
    const phone = toTenDigits(part.trim());
    if (!phone || phone.length !== 10) continue;
    const hit = { countryCode: DEFAULT_CC, phoneNumber: phone };
    if (/^[6-9]/.test(phone)) return hit;   // valid Indian mobile → use immediately
    if (!fallback) fallback = hit;          // landline-ish → keep only if nothing better turns up
  }
  return fallback;
}

export interface SendResult { ok: boolean; error?: string; id?: string; to?: string }

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
      // Keep newlines (the vendor list is multi-line) but drop tabs / runs of spaces,
      // which Meta does reject in variables.
      bodyValues: opts.bodyValues.map((v) => String(v ?? "").replace(/\t/g, " ").replace(/ {2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim()),
    },
  });

  const to = `${p.countryCode}${p.phoneNumber}`;
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
            if (okStatus && j.result !== false) resolve({ ok: true, id: j.id, to });
            else resolve({ ok: false, error: (j.message || body).toString().slice(0, 300), to });
          } catch {
            resolve({ ok: okStatus, error: okStatus ? undefined : body.slice(0, 300), to });
          }
        });
      },
    );
    req.on("error", (e) => resolve({ ok: false, error: e.message, to }));
    req.write(payload);
    req.end();
  });
}
