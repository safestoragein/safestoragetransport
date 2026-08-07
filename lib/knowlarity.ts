// Knowlarity (Super Receptionist) call log for the retrieval SR number.
//   GET https://kpi.knowlarity.com/Basic/v1/account/calllog
//   headers: authorization: <auth key> · x-api-key: <api key>
//   params : start_time / end_time ("YYYY-MM-DD HH:MM:SS"), limit, offset
// Verified live: the account returns customer_number, agent_number, call_duration, extension,
// start_time, call_recording and a uuid we dedupe on.
const BASE = process.env.KNOWLARITY_BASE || "https://kpi.knowlarity.com/Basic/v1/account/calllog";
const AUTH = process.env.KNOWLARITY_AUTH ?? "";
const XKEY = process.env.KNOWLARITY_API_KEY ?? "";
// Retrieval sits on IVR options 1 and 2; blank means the caller never chose one.
const RETRIEVAL_EXTENSIONS = (process.env.KNOWLARITY_EXTENSIONS ?? "1,2").split(",").map((s) => s.trim());

export const knowlarityConfigured = Boolean(AUTH && XKEY);

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface KCall {
  uuid: string; customer_number?: string; agent_number?: string; caller_name?: string;
  knowlarity_number?: string; extension?: string; call_duration?: number;
  call_recording?: string; start_time?: string;
}

const fmt = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

// Calls between two instants, oldest first. Pages until the range is exhausted.
export async function fetchCalls(since: Date, until: Date, max = 1000): Promise<KCall[]> {
  if (!knowlarityConfigured) throw new Error("Knowlarity is not configured (set KNOWLARITY_AUTH / KNOWLARITY_API_KEY)");
  const out: KCall[] = [];
  for (let offset = 0; out.length < max; offset += 500) {
    const q = new URLSearchParams({
      start_time: fmt(since), end_time: fmt(until),
      limit: "500", offset: String(offset),
    });
    const res = await fetch(`${BASE}?${q.toString()}`, {
      headers: { authorization: AUTH, "x-api-key": XKEY, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Knowlarity ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const j: any = await res.json();
    const rows: KCall[] = j?.objects ?? [];
    out.push(...rows);
    if (rows.length < 500) break;
  }
  return out.slice(0, max);
}

// Retrieval calls only — the IVR extension the team gave us.
export const isRetrievalCall = (c: KCall) =>
  RETRIEVAL_EXTENSIONS.includes(String(c.extension ?? "").trim());
/* eslint-enable @typescript-eslint/no-explicit-any */
