// Vendor master. Primary source = Supabase table `safestorage.vendors` (when SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY are set). Until then it falls back to the bundled Excel seed +
// a Vercel Blob overlay so the panel still works.

import seed from "./data/vendor-master.json";
import { put, list } from "@vercel/blob";

export type VehicleClass = "14ft" | "10ft" | "others";

export interface VendorMaster {
  id: string;
  city: string;
  name: string;
  vehicleType: VehicleClass;
  palletCapacity: number;
  tier: "general" | "non_general";
  dailyPrice: number | null;
  pricingNote: string | null;
  perTransaction: number | null;
  startingPoint: string;
  isIntercityVendor: boolean;
  // operational (from the teams/vehicles data, present in Supabase rows)
  systemTeamNo?: string | null;
  vehicleNo?: string | null;
  driverName?: string | null;
  driverContact?: string | null;
  supervisorName?: string | null;
  supervisorContact?: string | null;
  packerNames?: string | null;
  active: boolean;
  source: "excel" | "panel";
}

const CAP: Record<VehicleClass, number> = { "14ft": 7, "10ft": 4, others: 7 };
const EFF: Record<VehicleClass, number> = { "14ft": 7.5, "10ft": 4.2, others: 7.5 };

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const usingSupabase = Boolean(SUPA_URL && SUPA_KEY);

/* eslint-disable @typescript-eslint/no-explicit-any */
// Safe diagnostic (no secrets) to debug the Supabase connection.
export async function diagnose() {
  const hasUrl = Boolean(SUPA_URL);
  const hasKey = Boolean(SUPA_KEY);
  const urlOk = SUPA_URL ? /^https:\/\/[a-z0-9]+\.supabase\.co/.test(SUPA_URL) : false;
  const projectRef = SUPA_URL ? (SUPA_URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? null) : null;
  const keyType = !SUPA_KEY ? "none"
    : SUPA_KEY.startsWith("sb_secret_") ? "secret"
    : SUPA_KEY.startsWith("sb_publishable_") ? "publishable"
    : SUPA_KEY.startsWith("eyJ") ? "legacy-jwt"
    : "unknown";
  let error: string | null = null;
  let rows = 0;
  if (hasUrl && hasKey) {
    try {
      const c = await supa();
      const { data, error: e } = await c.from(TABLE).select("id").limit(1);
      if (e) error = `${e.message} (code ${e.code ?? "?"})`;
      else rows = (data ?? []).length;
    } catch (e) {
      error = (e as Error).message;
    }
  }
  return { usingSupabase, hasUrl, urlLooksValid: urlOk, projectRef, hasKey, keyType, testRows: rows, error };
}

// Reads/writes the `safestorage.vendors` table directly (the schema is exposed to the API).
const TABLE = "vendors";
async function supa() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(SUPA_URL!, SUPA_KEY!, { db: { schema: "safestorage" }, auth: { persistSession: false } });
}

function fromRow(r: any): VendorMaster {
  return {
    id: r.id,
    city: r.city,
    name: r.name,
    vehicleType: r.vehicle_type,
    palletCapacity: Number(r.pallet_capacity),
    tier: r.tier === "non_general" ? "non_general" : "general",
    dailyPrice: r.daily_price != null ? Number(r.daily_price) : null,
    pricingNote: r.pricing_note ?? null,
    perTransaction: r.per_transaction != null ? Number(r.per_transaction) : null,
    startingPoint: r.starting_point ?? "",
    isIntercityVendor: !!r.is_intercity_vendor,
    systemTeamNo: r.system_team_no ?? null,
    vehicleNo: r.vehicle_no ?? null,
    driverName: r.driver_name ?? null,
    driverContact: r.driver_contact ?? null,
    supervisorName: r.supervisor_name ?? null,
    supervisorContact: r.supervisor_contact ?? null,
    packerNames: r.packer_names ?? null,
    active: r.active !== false,
    source: r.source === "panel" ? "panel" : "excel",
  };
}

export interface NewVendorInput {
  city: string;
  name: string;
  vehicleType: VehicleClass;
  startingPoint: string;
  dailyPrice?: number | null;
  pricingNote?: string | null;
  isIntercityVendor?: boolean;
  tier?: "general" | "non_general";
  supervisorName?: string | null;
  supervisorContact?: string | null;
  driverName?: string | null;
  driverContact?: string | null;
  packerNames?: string | null;
  vehicleNo?: string | null;
  vehicleName?: string | null;
  systemTeamNo?: string | null;
  remarks?: string | null;
}

const blank = (s?: string | null) => (s && s.trim() ? s.trim() : null);

// ───────────────────────── public API ─────────────────────────
export async function listVendors(): Promise<{ vendors: VendorMaster[]; source: "supabase" | "seed" }> {
  if (usingSupabase) {
    try {
      const c = await supa();
      const { data, error } = await c.from(TABLE).select("*").eq("active", true).order("city").order("name");
      if (error) throw new Error(error.message);
      return { vendors: (data ?? []).map(fromRow), source: "supabase" };
    } catch (e) {
      console.error("[vendors] Supabase read failed (is the 'safestorage' schema exposed?):", (e as Error).message);
      return { vendors: await fallbackList(), source: "seed" };
    }
  }
  return { vendors: await fallbackList(), source: "seed" };
}

export async function addVendor(input: NewVendorInput): Promise<VendorMaster> {
  const vt = input.vehicleType;
  if (usingSupabase) {
    const c = await supa();
    const row = {
      city: input.city.trim(), name: input.name.trim(), vehicle_type: vt,
      pallet_capacity: CAP[vt], effective_capacity: EFF[vt],
      tier: input.vehicleType === "others" ? "non_general" : input.tier ?? "general",
      daily_price: input.dailyPrice ?? null, pricing_note: blank(input.pricingNote),
      starting_point: blank(input.startingPoint),
      is_intercity_vendor: !!input.isIntercityVendor,
      supervisor_name: blank(input.supervisorName), supervisor_contact: blank(input.supervisorContact),
      driver_name: blank(input.driverName), driver_contact: blank(input.driverContact),
      packer_names: blank(input.packerNames),
      vehicle_no: blank(input.vehicleNo), vehicle_name: blank(input.vehicleName),
      system_team_no: blank(input.systemTeamNo), remarks: blank(input.remarks),
      source: "panel",
    };
    const { data, error } = await c.from(TABLE).insert(row).select().single();
    if (error) throw new Error(error.message);
    return fromRow(data);
  }
  return fallbackAdd(input);
}

export async function updateVendor(id: string, patch: Partial<VendorMaster>): Promise<void> {
  if (usingSupabase) {
    const c = await supa();
    const row: any = {};
    if ("isIntercityVendor" in patch) row.is_intercity_vendor = patch.isIntercityVendor;
    if ("tier" in patch) row.tier = patch.tier;
    if ("dailyPrice" in patch) row.daily_price = patch.dailyPrice;
    if ("active" in patch) row.active = patch.active;
    const { error } = await c.from(TABLE).update(row).eq("id", id);
    if (error) throw new Error(error.message);
    return;
  }
  return fallbackUpdate(id, patch);
}

// ───────────────────────── Blob fallback (no Supabase) ─────────────────────────
interface Overlay { added: VendorMaster[]; overrides: Record<string, Partial<VendorMaster>>; }
const OVERLAY_PATH = "vendors-overlay.json";
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

async function readOverlay(): Promise<Overlay> {
  try {
    const { blobs } = await list({ prefix: OVERLAY_PATH });
    const b = blobs.find((x) => x.pathname === OVERLAY_PATH);
    if (!b) return { added: [], overrides: {} };
    const res = await fetch(`${b.url}?t=${Date.now()}`, { cache: "no-store" });
    const j = await res.json();
    return { added: j.added ?? [], overrides: j.overrides ?? {} };
  } catch {
    return { added: [], overrides: {} };
  }
}
async function writeOverlay(o: Overlay) {
  await put(OVERLAY_PATH, JSON.stringify(o), { access: "public", allowOverwrite: true, addRandomSuffix: false, contentType: "application/json", cacheControlMaxAge: 0 });
}
async function fallbackList(): Promise<VendorMaster[]> {
  const o = await readOverlay();
  const base = (seed as VendorMaster[]).map((v) => ({ ...v, ...(o.overrides[v.id] ?? {}) }));
  const added = o.added.map((v) => ({ ...v, ...(o.overrides[v.id] ?? {}) }));
  return [...base, ...added].filter((v) => v.active !== false);
}
async function fallbackAdd(input: NewVendorInput): Promise<VendorMaster> {
  const o = await readOverlay();
  const vt = input.vehicleType;
  const v: VendorMaster = {
    id: `${slug(`${input.city}-${input.name}-${vt}`)}-${o.added.length + 1}`,
    city: input.city.trim(), name: input.name.trim(), vehicleType: vt, palletCapacity: CAP[vt],
    tier: vt === "others" ? "non_general" : input.tier ?? "general",
    dailyPrice: input.dailyPrice ?? null, pricingNote: blank(input.pricingNote), perTransaction: null,
    startingPoint: (input.startingPoint || "").trim(), isIntercityVendor: !!input.isIntercityVendor,
    supervisorName: blank(input.supervisorName), supervisorContact: blank(input.supervisorContact),
    driverName: blank(input.driverName), driverContact: blank(input.driverContact),
    packerNames: blank(input.packerNames), vehicleNo: blank(input.vehicleNo),
    systemTeamNo: blank(input.systemTeamNo),
    active: true, source: "panel",
  };
  o.added.push(v); await writeOverlay(o); return v;
}
async function fallbackUpdate(id: string, patch: Partial<VendorMaster>) {
  const o = await readOverlay();
  o.overrides[id] = { ...(o.overrides[id] ?? {}), ...patch };
  await writeOverlay(o);
}
/* eslint-enable @typescript-eslint/no-explicit-any */
