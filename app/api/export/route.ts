// Excel export in the team's exact "Transport Schedules Sheet" format.
//   GET /api/export?date=YYYY-MM-DD             -> ALL cities, one tab each (like the team's workbook)
//   GET /api/export?date=YYYY-MM-DD&city=blr    -> a single city tab
// Columns match the manual sheet 1:1. The "Vehicle" column is the vendor from the PERSISTED schedule
// (exactly what the Schedule / Old-schedules screen shows), enriched with the full address / floor /
// lift / contact from the live order feed. Pallet = the SCHEDULED count (pickups already buffered).

import { NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { loadSchedule, loadAllSchedules } from "@/lib/schedule";
import { loadLiveRaw, listLiveCities } from "@/lib/safestorage-api";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const HEADERS = [
  "Customer Id", "Customer Notes", "Customer Name", "Contact", "Address",
  "Transport Charges", "Pallet", "Goods Location", "Vehicle", "Remarks",
  "Floor / Lift", "Time Slot",
];

const TYPE_LABEL: Record<string, string> = {
  pickup: "Pickup",
  full_retrieval: "Retrieval",
  partial_retrieval: "Partial Retrieval",
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/* eslint-disable @typescript-eslint/no-explicit-any */
async function buildCitySheet(citySlug: string, date: string) {
  const sched = await loadSchedule(citySlug, date).catch(() => null);
  const raw: any[] = await loadLiveRaw(citySlug, date).catch(() => []);
  const rawByRef = new Map<string, any>(raw.map((o) => [o.customer_unique_id, o]));

  // Persisted assignment (the Vehicle/team shown on screen), keyed by customer id.
  const bySched = new Map<string, any>();
  if (sched) for (const v of sched.vendors) for (const o of v.orders as any[]) bySched.set(o.customer_unique_id, { vendor: v.vendorName, ...o });

  const refs = [...new Set([...raw.map((o) => o.customer_unique_id), ...bySched.keys()])].filter(Boolean);

  const rows = refs.map((ref) => {
    const r = rawByRef.get(ref) ?? {};
    const s = bySched.get(ref);
    const otype = s?.order_type ?? r.order_type ?? "";
    const intercity = Boolean(r.is_intercity) || s?.is_intercity || /intercity|shifting/i.test(otype);
    const stated = s?.stated_pallets;
    const pallet = s?.pallets ?? (parseFloat(r.total_pallet) || "");
    const notes = [s?.team_notes ?? r.customer_notes ?? "", stated != null && Number(stated) !== Number(s?.pallets) ? `(customer stated ${stated}p)` : ""].filter(Boolean).join(" ");
    return [
      ref,
      notes,
      r.customer_name ?? s?.customer_name ?? "",
      [r.customer_contact1, r.customer_contact2].filter(Boolean).join(" / ") || s?.contact || "",
      r.order_address ?? s?.locality ?? "",
      s?.transport_charge ?? r.transport_cost ?? "",
      pallet,
      "",
      s?.vendor ?? "(unassigned)",
      intercity ? "Intercity" : TYPE_LABEL[otype] ?? otype,
      [r.floor ? `Floor: ${r.floor}` : "", r.lift ? `Lift: ${r.lift}` : ""].filter(Boolean).join(" / "),
      s?.time_slot ?? r.order_timeslot ?? "",
    ];
  });

  // group by Vehicle (team), so the sheet reads like a per-team dispatch list
  rows.sort((a, b) => String(a[8]).localeCompare(String(b[8])) || String(a[0]).localeCompare(String(b[0])));

  const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...rows]);
  ws["!cols"] = [
    { wch: 12 }, { wch: 22 }, { wch: 20 }, { wch: 16 }, { wch: 48 },
    { wch: 14 }, { wch: 8 }, { wch: 16 }, { wch: 24 }, { wch: 16 }, { wch: 18 }, { wch: 18 },
  ];
  return { name: cap(citySlug).slice(0, 28), ws, count: rows.length };
}

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  const cityParam = req.nextUrl.searchParams.get("city");

  let citySlugs: string[];
  if (cityParam) {
    citySlugs = [cityParam];
  } else {
    const all = await loadAllSchedules(date).catch(() => ({ cities: [] as any[] }));
    citySlugs = all.cities.map((c: any) => c.city);
    if (!citySlugs.length) citySlugs = (await listLiveCities(date)).filter((c) => c.count > 0).map((c) => c.slug);
  }

  const wb = XLSX.utils.book_new();
  for (const slug of citySlugs) {
    const sheet = await buildCitySheet(slug, date);
    XLSX.utils.book_append_sheet(wb, sheet.ws, sheet.name);
  }
  if (wb.SheetNames.length === 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADERS]), "No data");
  }

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const dmy = date.split("-").reverse().join("_");
  const filename = cityParam ? `${dmy} ${cap(cityParam)} Transport Schedule.xlsx` : `${dmy} Transport Schedules Sheet.xlsx`;
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */
