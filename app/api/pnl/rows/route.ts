// Order-level P&L rows for the Weekly / Monthly P&L tab.
//   GET /api/pnl/rows?from=&to=&vendor=&city=            -> { ok, rows, vendors, cities, totals }
//   GET /api/pnl/rows?from=&to=&vendor=&city=&format=xlsx -> the team's workbook (same 17 columns)
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { pnlRows, rowToArray, PNL_HEADERS, unpricedVendors } from "@/lib/pnl-rows";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const from = p.get("from");
  const to = p.get("to");
  if (!from || !to) return NextResponse.json({ ok: false, error: "from and to are required" }, { status: 400 });
  const vendor = p.get("vendor");
  const city = p.get("city");

  try {
    // Both dropdowns are built from the UNFILTERED range so neither ever loses its options.
    const all = await pnlRows(from, to, null);
    const rows = all
      .filter((r) => !vendor || vendor === "All" || r.teams === vendor)
      .filter((r) => !city || city === "All" || r.city === city);

    if (p.get("format") === "xlsx") {
      const ws = XLSX.utils.aoa_to_sheet([[...PNL_HEADERS], ...rows.map(rowToArray)]);
      ws["!cols"] = [
        { wch: 11 }, { wch: 12 }, { wch: 10 }, { wch: 22 }, { wch: 22 }, { wch: 16 }, { wch: 8 },
        { wch: 16 }, { wch: 18 }, { wch: 20 }, { wch: 15 }, { wch: 17 }, { wch: 15 },
        { wch: 10 }, { wch: 14 }, { wch: 18 }, { wch: 24 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Schedules");
      const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="SafeStorage P&L ${from} to ${to}${city && city !== "All" ? ` ${city}` : ""}.xlsx"`,
        },
      });
    }

    const blank = () => ({ orders: 0, pallets: 0, storage: 0, transport: 0, shifting: 0, porter: 0, packageCharges: 0, vendorPayment: 0, pnl: 0 });
    const add = (t: any, r: any) => {
      t.orders += 1;
      t.pallets = Math.round((t.pallets + (r.pallets ?? 0)) * 10) / 10;
      t.storage += r.storageCharges; t.transport += r.transportCharges; t.shifting += r.shiftingCharges;
      t.porter += r.porterCharges; t.packageCharges += r.packageCharges;
      t.vendorPayment += r.vendorPayment; t.pnl += r.pnl;
      return t;
    };
    const totals = rows.reduce(add, blank());

    // day-wise roll-up, so the team can see which days made or lost money
    const byDateMap = new Map<string, any>();
    for (const r of rows) {
      if (!byDateMap.has(r.date)) byDateMap.set(r.date, { date: r.date, ...blank() });
      add(byDateMap.get(r.date), r);
    }
    const byDate = [...byDateMap.values()].sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json({
      ok: true, from, to, rows, totals, byDate,
      unpriced: unpricedVendors(rows),
      vendors: [...new Set(all.map((r) => r.teams))].sort(),
      cities: [...new Set(all.map((r) => r.city))].filter(Boolean).sort(),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message, rows: [] }, { status: 500 });
  }
}
