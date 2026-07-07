// Vendor master. Primary source = MySQL table `safestorage.vendors` (when the MYSQL_* env is
// set). Until then it falls back to the bundled Excel seed + a Vercel Blob overlay so the panel
// still works.

import seed from "./data/vendor-master.json";
import { put, list } from "@vercel/blob";
import { db, hasDb } from "./db";

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
  doesLocal: boolean; // does this vendor also do LOCAL pickup/retrieval? if yes it's in the general pool
  appPin: string | null; // PIN the vendor uses to log into the mobile app
  // operational (from the teams/vehicles data, present in Supabase rows)
  systemTeamNo?: string | null;
  vehicleNo?: string | null;
  driverName?: string | null;
  driverContact?: string | null;
  supervisorName?: string | null;
  supervisorContact?: string | null;
  packerNames?: string | null;
  // compliance
  securityDeposit?: number | null;
  serviceAgreementUrl?: string | null;
  gstDocumentUrl?: string | null;
  // extras
  notes?: string | null;
  priorityGroup?: string | null; // 'A' | 'B' | 'C'
  billingCycle?: string | null; // 'daily' | 'weekly' | 'monthly'
  supervisors?: { name: string; phone: string }[] | null; // up to 10
  active: boolean;
  source: "excel" | "panel";
}

const CAP: Record<VehicleClass, number> = { "14ft": 7, "10ft": 4, others: 7 };
const EFF: Record<VehicleClass, number> = { "14ft": 7.5, "10ft": 4.2, others: 7.5 };

// Rated (pallet_capacity) + effective for a vendor. For "others" the office picks the class it
// behaves like — 7 pallets (like a 14ft) or 4 (like a 10ft); we snap to those two so the scheduler's
// capacity decision is unambiguous. Everything else uses the fixed per-type numbers above.
function capFor(vt: VehicleClass, palletCapacity?: number | null): { cap: number; eff: number } {
  if (vt === "others" && palletCapacity != null) {
    return Number(palletCapacity) <= 5.5 ? { cap: 4, eff: 4.2 } : { cap: 7, eff: 7.5 };
  }
  return { cap: CAP[vt], eff: EFF[vt] };
}

export const usingSupabase = hasDb; // "using the DB" — name kept for compatibility

/* eslint-disable @typescript-eslint/no-explicit-any */
// Safe diagnostic (no secrets) to debug the MySQL connection.
export async function diagnose() {
  const host = process.env.MYSQL_HOST ?? null;
  const database = process.env.MYSQL_DATABASE ?? null;
  const viaUrl = Boolean(process.env.MYSQL_URL);
  let error: string | null = null;
  let rows = 0;
  if (hasDb) {
    try {
      const c = await supa();
      const { data, error: e } = await c.from(TABLE).select("id").limit(1);
      if (e) error = `${e.message} (code ${e.code ?? "?"})`;
      else rows = (data ?? []).length;
    } catch (e) {
      error = (e as Error).message;
    }
  }
  return { usingDb: hasDb, driver: "mysql", viaUrl, host, database, testRows: rows, error };
}

// Reads/writes the `safestorage.vendors` table via the shared MySQL client.
const TABLE = "vendors";
async function supa() {
  return db();
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
    // Before the migration runs the column is absent -> a vendor does local unless it's intercity.
    doesLocal: r.does_local != null ? !!r.does_local : !r.is_intercity_vendor,
    appPin: r.app_pin ?? null,
    systemTeamNo: r.system_team_no ?? null,
    vehicleNo: r.vehicle_no ?? null,
    driverName: r.driver_name ?? null,
    driverContact: r.driver_contact ?? null,
    supervisorName: r.supervisor_name ?? null,
    supervisorContact: r.supervisor_contact ?? null,
    packerNames: r.packer_names ?? null,
    securityDeposit: r.security_deposit != null ? Number(r.security_deposit) : null,
    serviceAgreementUrl: r.service_agreement_url ?? null,
    gstDocumentUrl: r.gst_document_url ?? null,
    notes: r.notes ?? null,
    priorityGroup: r.priority_group ?? null,
    billingCycle: r.billing_cycle ?? null,
    // JSON column: MySQL returns a parsed array, MariaDB returns a JSON string — handle both.
    supervisors: parseSupervisors(r.supervisors),
    active: r.active !== false,
    source: r.source === "panel" ? "panel" : "excel",
  };
}

export interface NewVendorInput {
  city: string;
  name: string;
  vehicleType: VehicleClass;
  palletCapacity?: number | null; // only used for "others": 7 (behaves like 14ft) or 4 (like 10ft)
  startingPoint: string;
  dailyPrice?: number | null;
  pricingNote?: string | null;
  isIntercityVendor?: boolean;
  doesLocal?: boolean;
  appPin?: string | null;
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
  securityDeposit?: number | null;
  notes?: string | null;
  priorityGroup?: string | null;
  billingCycle?: string | null;
  supervisors?: { name: string; phone: string }[] | null;
}

const blank = (s?: string | null) => (s && s.trim() ? s.trim() : null);

// Extract the offending column from a DB "unknown column" error so a not-yet-migrated column can
// be dropped and the save retried. Handles MariaDB/MySQL ("Unknown column 'app_pin' in 'field
// list'"), Postgres ('column "app_pin"'), and the generic "'app_pin' column" wording.
function unknownColumn(msg: string): string | undefined {
  const m =
    msg.match(/[Uu]nknown column '([a-z_]+)'/) ||
    msg.match(/column "([a-z_]+)"/) ||
    msg.match(/'([a-z_]+)' column/);
  return m?.[1];
}

// Vendor `supervisors` is a JSON column. mysql2 auto-parses it on MySQL 8 (array),
// but on MariaDB the JSON type is text so it comes back as a string — parse it here.
function parseSupervisors(v: any): { name: string; phone: string }[] | null {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.trim()) {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : null; } catch { return null; }
  }
  return null;
}

// ───────────────────────── public API ─────────────────────────
export async function listVendors(): Promise<{ vendors: VendorMaster[]; source: "supabase" | "seed" }> {
  if (usingSupabase) {
    try {
      const c = await supa();
      // Panel shows ALL vendors (active + inactive) so they can be toggled; the scheduler filters
      // active separately (masterVendorsForCity).
      const { data, error } = await c.from(TABLE).select("*").order("city").order("name");
      if (error) throw new Error(error.message);
      return { vendors: (data ?? []).map(fromRow), source: "supabase" };
    } catch (e) {
      console.error("[vendors] MySQL read failed (is the 'safestoragetransport' schema reachable?):", (e as Error).message);
      return { vendors: await fallbackList(), source: "seed" };
    }
  }
  return { vendors: await fallbackList(), source: "seed" };
}

export async function addVendor(input: NewVendorInput): Promise<VendorMaster> {
  const vt = input.vehicleType;
  const sups = (input.supervisors ?? []).filter((s) => s?.name?.trim() || s?.phone?.trim()).map((s) => ({ name: s.name.trim(), phone: s.phone.trim() })).slice(0, 10);
  if (usingSupabase) {
    const c = await supa();
    const row = {
      city: input.city.trim(), name: input.name.trim(), vehicle_type: vt,
      pallet_capacity: capFor(vt, input.palletCapacity).cap, effective_capacity: capFor(vt, input.palletCapacity).eff,
      tier: input.vehicleType === "others" ? "non_general" : input.tier ?? "general",
      daily_price: input.dailyPrice ?? null, pricing_note: blank(input.pricingNote),
      starting_point: blank(input.startingPoint),
      is_intercity_vendor: !!input.isIntercityVendor,
      does_local: input.doesLocal != null ? !!input.doesLocal : !input.isIntercityVendor,
      app_pin: blank(input.appPin),
      // primary supervisor mirrors supervisors[0] so existing schedule displays keep working
      supervisor_name: blank(sups?.[0]?.name ?? input.supervisorName), supervisor_contact: blank(sups?.[0]?.phone ?? input.supervisorContact),
      driver_name: blank(input.driverName), driver_contact: blank(input.driverContact),
      packer_names: blank(input.packerNames),
      vehicle_no: blank(input.vehicleNo), vehicle_name: blank(input.vehicleName),
      system_team_no: blank(input.systemTeamNo), remarks: blank(input.remarks),
      security_deposit: input.securityDeposit ?? null,
      notes: blank(input.notes), priority_group: blank(input.priorityGroup), billing_cycle: blank(input.billingCycle), supervisors: sups.length ? sups : null,
      source: "panel",
    };
    // Drop any column whose migration hasn't run yet and retry, so adding a vendor still works.
    let attempt: any = row;
    for (let i = 0; i < 10; i++) {
      const { data, error } = await c.from(TABLE).insert(attempt).select().single();
      if (!error) return fromRow(data);
      const col = unknownColumn(error.message);
      if (col && col in attempt) { const { [col]: _drop, ...rest } = attempt; attempt = rest; continue; }
      throw new Error(error.message);
    }
    throw new Error("could not insert vendor");
  }
  return fallbackAdd(input);
}

export async function updateVendor(id: string, patch: Partial<VendorMaster>): Promise<void> {
  if (usingSupabase) {
    const c = await supa();
    const row: any = {};
    // map camelCase patch keys -> snake_case columns; only set what's present
    const M: Record<string, string> = {
      isIntercityVendor: "is_intercity_vendor", doesLocal: "does_local", appPin: "app_pin", tier: "tier", dailyPrice: "daily_price",
      pricingNote: "pricing_note", startingPoint: "starting_point", name: "name",
      supervisorName: "supervisor_name", supervisorContact: "supervisor_contact",
      driverName: "driver_name", driverContact: "driver_contact", packerNames: "packer_names",
      vehicleNo: "vehicle_no", systemTeamNo: "system_team_no",
      securityDeposit: "security_deposit", serviceAgreementUrl: "service_agreement_url",
      gstDocumentUrl: "gst_document_url", active: "active",
      notes: "notes", priorityGroup: "priority_group", billingCycle: "billing_cycle",
    };
    for (const [k, col] of Object.entries(M)) if (k in patch) row[col] = (patch as any)[k];
    // Vehicle-type change (team swaps a 10ft ⇄ 14ft, or picks "others"): set the type AND recompute
    // rated + effective capacity so the scheduler caps it correctly. "others" honours an explicit
    // palletCapacity; 14ft/10ft use their fixed numbers.
    if ("vehicleType" in patch && (patch as any).vehicleType) {
      const vt = (patch as any).vehicleType as VehicleClass;
      const cp = capFor(vt, (patch as any).palletCapacity);
      row.vehicle_type = vt; row.pallet_capacity = cp.cap; row.effective_capacity = cp.eff;
    } else if ("palletCapacity" in patch && (patch as any).palletCapacity != null) {
      // "others" capacity edit: snap to the 7- or 4-pallet class and keep effective in sync.
      const cp = capFor("others", Number((patch as any).palletCapacity));
      row.pallet_capacity = cp.cap; row.effective_capacity = cp.eff;
    }
    if ("supervisors" in patch) {
      const sups = (patch.supervisors ?? []).filter((s) => s?.name?.trim() || s?.phone?.trim()).map((s) => ({ name: s.name.trim(), phone: s.phone.trim() })).slice(0, 10);
      row.supervisors = sups.length ? sups : null;
      // keep the primary supervisor column in sync (used by the schedule views)
      row.supervisor_name = sups[0]?.name ?? null;
      row.supervisor_contact = sups[0]?.phone ?? null;
    }
    if (Object.keys(row).length === 0) return;
    // A column whose migration hasn't run yet must NOT block the whole save — drop the offending
    // column and retry with the rest, so core fields still persist.
    let attempt: any = row;
    for (let i = 0; i < 10; i++) {
      const { error } = await c.from(TABLE).update(attempt).eq("id", id);
      if (!error) return;
      const col = unknownColumn(error.message);
      if (col && col in attempt) {
        const { [col]: _drop, ...rest } = attempt;
        if (Object.keys(rest).length === 0) return; // only field was un-migrated → nothing to persist yet
        attempt = rest; continue;
      }
      throw new Error(error.message);
    }
    return;
  }
  return fallbackUpdate(id, patch);
}

export async function deleteVendor(id: string): Promise<void> {
  if (usingSupabase) {
    const c = await supa();
    const { error } = await c.from(TABLE).delete().eq("id", id);
    if (error) throw new Error(error.message);
    return;
  }
  return fallbackDelete(id);
}

// ───────────────────────── Blob fallback (no Supabase) ─────────────────────────
interface Overlay { added: VendorMaster[]; overrides: Record<string, Partial<VendorMaster>>; deleted?: string[] }
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
  const deleted = new Set(o.deleted ?? []);
  const base = (seed as VendorMaster[]).map((v) => ({ ...v, ...(o.overrides[v.id] ?? {}) }));
  const added = o.added.map((v) => ({ ...v, ...(o.overrides[v.id] ?? {}) }));
  return [...base, ...added].filter((v) => !deleted.has(v.id)); // show all (active + inactive) for the panel
}
async function fallbackAdd(input: NewVendorInput): Promise<VendorMaster> {
  const o = await readOverlay();
  const vt = input.vehicleType;
  const v: VendorMaster = {
    id: `${slug(`${input.city}-${input.name}-${vt}`)}-${o.added.length + 1}`,
    city: input.city.trim(), name: input.name.trim(), vehicleType: vt, palletCapacity: capFor(vt, input.palletCapacity).cap,
    tier: vt === "others" ? "non_general" : input.tier ?? "general",
    dailyPrice: input.dailyPrice ?? null, pricingNote: blank(input.pricingNote), perTransaction: null,
    startingPoint: (input.startingPoint || "").trim(), isIntercityVendor: !!input.isIntercityVendor,
    doesLocal: input.doesLocal != null ? !!input.doesLocal : !input.isIntercityVendor,
    appPin: blank(input.appPin),
    supervisorName: blank(input.supervisorName), supervisorContact: blank(input.supervisorContact),
    driverName: blank(input.driverName), driverContact: blank(input.driverContact),
    packerNames: blank(input.packerNames), vehicleNo: blank(input.vehicleNo),
    systemTeamNo: blank(input.systemTeamNo),
    securityDeposit: input.securityDeposit ?? null, serviceAgreementUrl: null, gstDocumentUrl: null,
    active: true, source: "panel",
  };
  o.added.push(v); await writeOverlay(o); return v;
}
async function fallbackUpdate(id: string, patch: Partial<VendorMaster>) {
  const o = await readOverlay();
  o.overrides[id] = { ...(o.overrides[id] ?? {}), ...patch };
  await writeOverlay(o);
}
async function fallbackDelete(id: string) {
  const o = await readOverlay();
  o.added = o.added.filter((v) => v.id !== id);
  o.deleted = [...new Set([...(o.deleted ?? []), id])];
  await writeOverlay(o);
}
/* eslint-enable @typescript-eslint/no-explicit-any */
