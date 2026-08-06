// Order-level P&L rows for the Weekly / Monthly P&L tab, in the EXACT column order of the team's
// "Daily Schedules Transport Charges" workbook.
//
// Reads straight from the persisted tables (runs → assignments → orders/vendors) rather than
// loadSchedule(), because a month-long range would otherwise fan out into hundreds of OSRM route
// calls and time out.
//
// Charges follow the team's invoicing rule (2026-08-06): a pickup is billed on the QUOTATION until
// the goods are counted (completed / stacking / updated), and on the INVENTORY figures after — that
// choice is already baked into orders.transport_charge / storage_charges when the snapshot syncs.
import { db, hasDb } from "./db";
import { PACKAGE_PER_PALLET } from "./config";

/* eslint-disable @typescript-eslint/no-explicit-any */

// The team's 17 columns, in their exact order, then the three derived P&L columns.
export const PNL_HEADERS = [
  "Date", "City", "Cust id", "Cust Name", "Teams", "Team Names", "Pallets", "Order Type",
  "Vehicle", "Porter/Vendor Charges", "Storage Charges", "Transport Charges", "Shifting Charges",
  "Payment", "Google Reviews", "Comment", "Remarks",
  "Package Charges", "Vendor Payment", "P&L",
] as const;

export { PACKAGE_PER_PALLET } from "./config";

export interface PnlRow {
  date: string; city: string; custId: string; custName: string;
  teams: string; teamNames: string; pallets: number | null; orderType: string;
  vehicle: string; porterCharges: number; storageCharges: number; transportCharges: number;
  shiftingCharges: number; payment: string; googleReviews: string; comment: string; remarks: string;
  packageCharges: number;   // pallets x PACKAGE_PER_PALLET, pickups only
  vendorPayment: number;    // this order's share of what the vendor is paid (see below)
  pnl: number;              // collected - vendor payment - packing
}

const cityName = (s: string) => String(s ?? "").replace(/(^|[\s-])\w/g, (m) => m.toUpperCase());
const typeLabel = (t: string) =>
  /partial/i.test(t) ? "Partial Retrieval" : /retriev/i.test(t) ? "Retrieval" : "Pickup";
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export async function pnlRows(from: string, to: string, vendor?: string | null): Promise<PnlRow[]> {
  if (!hasDb) return [];
  const c = db();

  // latest run per (date, city) — matches what the schedule screens show
  const { data: runs } = await c.from("schedule_runs")
    .select("id, schedule_date, city, generated_at")
    .gte("schedule_date", from).lte("schedule_date", to)
    .order("generated_at", { ascending: false });
  const latest = new Map<string, any>();
  for (const r of (runs ?? []) as any[]) {
    const k = `${r.schedule_date}|${r.city}`;
    if (!latest.has(k)) latest.set(k, r);
  }
  const runList = [...latest.values()];
  if (!runList.length) return [];
  const runById = new Map(runList.map((r) => [String(r.id), r]));

  const { data: assigns } = await c.from("schedule_assignments")
    .select("run_id, order_id, vendor_id, vendor_name, stop_seq, trip_no")
    .in("run_id", runList.map((r) => r.id));

  // one row per order per run; co-team rows (stop_seq -1) would duplicate the charge
  const seen = new Set<string>();
  const picked: any[] = [];
  for (const a of (assigns ?? []) as any[]) {
    if (!a.order_id || a.stop_seq === -1) continue;
    const k = `${a.run_id}|${a.order_id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    picked.push(a);
  }
  if (!picked.length) return [];

  const orderById = new Map<string, any>();
  const ids = [...new Set(picked.map((a) => a.order_id))];
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await c.from("orders").select("*").in("id", ids.slice(i, i + 500));
    for (const o of (data ?? []) as any[]) orderById.set(String(o.id), o);
  }

  // Vendor master → supervisor, vehicle and the day/transaction rate.
  // Matched by ID FIRST: several vendors share a name (three different "Rainbow Packers" records),
  // so a name-keyed lookup silently resolved to whichever row happened to be last — often an
  // intercity record with no rate, which is why the payment column read ₹0.
  const vendorById = new Map<string, any>();
  const vendorByName = new Map<string, any>();
  try {
    const { data: vs } = await c.from("vendors")
      .select("id, name, supervisor_name, vehicle_type, vehicle_no, tier, daily_price, per_transaction, is_intercity_vendor");
    for (const v of (vs ?? []) as any[]) {
      vendorById.set(String(v.id), v);
      // When the name IS the only thing we have, keep the record that actually carries a rate.
      const prev = vendorByName.get(String(v.name));
      const rate = (x: any) => num(x?.daily_price) || num(x?.per_transaction);
      if (!prev || rate(v) > rate(prev)) vendorByName.set(String(v.name), v);
    }
  } catch { /* vendor extras are cosmetic */ }

  // What one order costs us from this vendor. A per-transaction vendor is paid per job; a vendor on
  // a flat day rate has that rate split across their jobs for the day, so the rows sum to the day
  // rate rather than repeating it. If the panel only has ONE of the two rates recorded we use it
  // either way — reporting ₹0 for a vendor who is plainly being paid would be worse than
  // approximating from the rate we do have.
  const payForOrder = (v: any, ordersToday: number): number => {
    if (!v) return 0;
    const daily = num(v.daily_price);
    const perTxn = num(v.per_transaction);
    const wantsPerTxn = v.tier === "non_general" || !!v.is_intercity_vendor;
    const share = daily / Math.max(1, ordersToday);
    if (wantsPerTxn) return Math.round(perTxn || share);
    return Math.round(daily ? share : perTxn);
  };

  // VENDOR PAYMENT. A general vendor is paid a flat DAY rate however many jobs they run, so the
  // day rate is split across that vendor's orders for the day — otherwise a 5-stop day would be
  // charged five times over in the totals. Per-transaction vendors (non-general / intercity) are
  // genuinely paid per job, so each order carries the full transaction fee.
  const ordersPerVendorDay = new Map<string, number>();
  for (const a of picked) {
    const o = orderById.get(String(a.order_id));
    const run = runById.get(String(a.run_id));
    if (!o || !a.vendor_name) continue;
    const k = `${String(run?.schedule_date ?? "").slice(0, 10)}|${a.vendor_name}`;
    ordersPerVendorDay.set(k, (ordersPerVendorDay.get(k) ?? 0) + 1);
  }

  const want = String(vendor ?? "").trim().toLowerCase();
  const rows: PnlRow[] = [];
  for (const a of picked) {
    const o = orderById.get(String(a.order_id));
    if (!o) continue;
    const run = runById.get(String(a.run_id));
    const team = a.vendor_name ?? "";
    if (want && want !== "all" && String(team).toLowerCase() !== want) continue;
    const v = (a.vendor_id ? vendorById.get(String(a.vendor_id)) : null) ?? vendorByName.get(String(team));
    const isShifting = !!o.is_shifting;
    const transport = num(o.transport_charge);
    const isPickup = !/retriev/i.test(String(o.order_type ?? ""));
    const pallets = o.stated_pallets != null ? Number(o.stated_pallets) : (o.pallets != null ? Number(o.pallets) : 0);
    const packageCharges = isPickup ? Math.round((Number(pallets) || 0) * PACKAGE_PER_PALLET) : 0;

    const date = String(run?.schedule_date ?? o.schedule_date ?? "").slice(0, 10);
    const vendorPayment = team ? payForOrder(v, ordersPerVendorDay.get(`${date}|${team}`) ?? 1) : 0;
    const collected = isShifting ? transport : transport; // storage is deliberately NOT revenue here
    rows.push({
      packageCharges, vendorPayment,
      pnl: Math.round(collected - vendorPayment - packageCharges),
      date,
      city: cityName(o.city ?? run?.city ?? ""),
      custId: o.customer_unique_id ?? "",
      custName: o.customer_name ?? "",
      teams: team || "— unassigned —",
      teamNames: v?.supervisor_name ?? "",
      pallets: o.stated_pallets != null ? Number(o.stated_pallets) : (o.pallets != null ? Number(o.pallets) : null),
      orderType: typeLabel(String(o.order_type ?? "")),
      vehicle: v?.vehicle_type ? `${v.vehicle_type}${v.vehicle_no ? ` · ${v.vehicle_no}` : ""}` : "Vendor Vehicle",
      porterCharges: 0,                                   // recorded manually by the team
      storageCharges: num(o.storage_charges),
      // A shifting job is billed under its own column in the team's sheet, not as transport.
      transportCharges: isShifting ? 0 : transport,
      shiftingCharges: isShifting ? transport : 0,
      payment: "", googleReviews: "", comment: "",
      remarks: String(o.team_notes ?? "").trim(),
    });
  }

  rows.sort((x, y) => x.date.localeCompare(y.date) || x.city.localeCompare(y.city)
    || x.teams.localeCompare(y.teams) || x.custId.localeCompare(y.custId));
  return rows;
}

// Vendors that worked in the range but have NO rate in the panel — their orders show ₹0 vendor
// payment, which flatters the P&L. Surfaced so the team can fill the rate in.
export function unpricedVendors(rows: PnlRow[]): string[] {
  const worked = new Map<string, boolean>();
  for (const r of rows) {
    if (r.teams === "— unassigned —") continue;
    worked.set(r.teams, (worked.get(r.teams) ?? false) || r.vendorPayment > 0);
  }
  return [...worked.entries()].filter(([, priced]) => !priced).map(([n]) => n).sort();
}

export const rowToArray = (r: PnlRow) => [
  r.date, r.city, r.custId, r.custName, r.teams, r.teamNames, r.pallets, r.orderType,
  r.vehicle, r.porterCharges, r.storageCharges, r.transportCharges, r.shiftingCharges,
  r.payment, r.googleReviews, r.comment, r.remarks,
  r.packageCharges, r.vendorPayment, r.pnl,
];
/* eslint-enable @typescript-eslint/no-explicit-any */
