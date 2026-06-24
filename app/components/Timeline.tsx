"use client";

import { OptimizationResult, Booking } from "@/lib/types";
import { parseSlot, fmtMin } from "@/lib/timeslot";
import { vendorColor, Card } from "./ui";

interface Block {
  b: Booking;
  start: number;
  end: number;
  lane: number;
}

// Lane-pack overlapping blocks within one row so time conflicts are visible (stacked).
function pack(items: { b: Booking; start: number; end: number }[]): { blocks: Block[]; lanes: number } {
  const sorted = [...items].sort((a, b) => a.start - b.start);
  const laneEnds: number[] = [];
  const blocks: Block[] = sorted.map((it) => {
    let lane = laneEnds.findIndex((end) => end <= it.start);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(it.end); }
    else laneEnds[lane] = it.end;
    return { ...it, lane };
  });
  return { blocks, lanes: Math.max(1, laneEnds.length) };
}

export default function Timeline({ result }: { result: OptimizationResult }) {
  const byId = new Map(result.bookings.map((b) => [b.id, b]));

  // parse every booking's slot
  // A customer-requested time (from team notes) overrides the booked slot — we must schedule there.
  const parsed = new Map<string, { start: number; end: number } | null>();
  result.bookings.forEach((b) => {
    if (b.requiredSlot) { parsed.set(b.id, b.requiredSlot); return; }
    const s = parseSlot(b.timeSlot);
    parsed.set(b.id, s ? { start: s.startMin, end: s.endMin } : null);
  });

  const allRanges = [...parsed.values()].filter(Boolean) as { start: number; end: number }[];
  let rangeStart = 8 * 60, rangeEnd = 20 * 60;
  if (allRanges.length) {
    rangeStart = Math.min(rangeStart, Math.floor(Math.min(...allRanges.map((r) => r.start)) / 60) * 60);
    rangeEnd = Math.max(rangeEnd, Math.ceil(Math.max(...allRanges.map((r) => r.end)) / 60) * 60);
  }
  const span = rangeEnd - rangeStart;
  const pct = (min: number) => ((min - rangeStart) / span) * 100;

  const rows = result.assignments
    .map((a) => {
      const idx = result.vendors.findIndex((v) => v.id === a.vendorId);
      const name = result.vendors.find((v) => v.id === a.vendorId)?.name ?? a.vendorId;
      const items = a.bookingIds
        .map((id) => byId.get(id))
        .filter((b): b is Booking => !!b && !!parsed.get(b.id))
        .map((b) => ({ b, ...(parsed.get(b.id) as { start: number; end: number }) }));
      return { vendorId: a.vendorId, name, color: vendorColor(idx), ...pack(items) };
    })
    .filter((r) => r.blocks.length > 0);

  const unscheduled = result.bookings.filter((b) => {
    const assigned = result.assignments.some((a) => a.bookingIds.includes(b.id));
    return assigned && !parsed.get(b.id);
  });

  const hours: number[] = [];
  for (let t = rangeStart; t <= rangeEnd; t += 60) hours.push(t);
  const LANE_H = 30;

  return (
    <Card className="p-5">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Day timeline · by vehicle</h3>
        <span className="text-xs text-slate-500">{rows.length} vehicles · slot conflicts stack vertically</span>
      </div>
      <p className="mb-4 text-xs text-slate-500">Each bar is a pickup at its booked time slot. Overlapping bars on one row = a scheduling clash to resolve.</p>

      <div className="overflow-x-auto">
        <div className="min-w-[760px]">
          {/* hour header */}
          <div className="flex">
            <div className="w-44 shrink-0" />
            <div className="relative h-6 flex-1 border-b border-slate-200">
              {hours.map((t) => (
                <div key={t} className="absolute top-0 -translate-x-1/2 text-[11px] text-slate-400" style={{ left: `${pct(t)}%` }}>{fmtMin(t)}</div>
              ))}
            </div>
          </div>

          {/* rows */}
          {rows.map((r) => (
            <div key={r.vendorId} className="flex items-stretch border-b border-slate-100">
              <div className="flex w-44 shrink-0 items-center gap-2 py-2 pr-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: r.color }} />
                <span className="truncate text-xs font-medium text-slate-700">{r.name}</span>
              </div>
              <div className="relative flex-1" style={{ height: r.lanes * LANE_H + 8 }}>
                {hours.map((t) => (
                  <div key={t} className="absolute top-0 bottom-0 border-l border-slate-100" style={{ left: `${pct(t)}%` }} />
                ))}
                {r.blocks.map((blk) => {
                  const fixed = !!blk.b.requiredTimeText;
                  return (
                    <div
                      key={blk.b.id}
                      title={`${blk.b.refNo} · ${blk.b.location.label} · ${blk.b.pallets}p\n${blk.b.customerName}\n${fmtMin(blk.start)}–${fmtMin(blk.end)} · ${r.name}${fixed ? `\n⏰ customer requested: ${blk.b.requiredTimeText}` : ""}`}
                      className="absolute flex items-center overflow-hidden rounded px-1.5 text-[10px] font-medium text-white"
                      style={{
                        left: `${pct(blk.start)}%`,
                        width: `${Math.max(4, pct(blk.end) - pct(blk.start))}%`,
                        top: blk.lane * LANE_H + 4,
                        height: LANE_H - 6,
                        backgroundColor: r.color,
                        boxShadow: fixed ? "0 0 0 2px #d97706" : undefined,
                      }}
                    >
                      <span className="truncate">{fixed ? "⏰ " : ""}{blk.b.location.label} · {blk.b.pallets}p</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {unscheduled.length > 0 && (
        <div className="mt-4 rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200">
          <div className="text-xs font-medium text-amber-800">{unscheduled.length} assigned order(s) have no time slot yet</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {unscheduled.map((b) => (
              <span key={b.id} className="rounded bg-white px-1.5 py-0.5 text-[11px] text-amber-700 ring-1 ring-amber-200">{b.refNo} · {b.location.label}</span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
