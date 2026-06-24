"use client";

import { Diagnostics } from "@/lib/diagnostics";
import { Card } from "./ui";

const TONE: Record<string, string> = {
  high: "border-red-200 bg-red-50 text-red-800",
  medium: "border-amber-200 bg-amber-50 text-amber-800",
  low: "border-slate-200 bg-slate-50 text-slate-700",
};
const DOT: Record<string, string> = { high: "bg-red-500", medium: "bg-amber-500", low: "bg-slate-400" };

export default function DiagnosticsPanel({ d }: { d: Diagnostics }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Plan health check</h3>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${d.findings.length ? "bg-amber-50 text-amber-700 ring-amber-200" : "bg-emerald-50 text-emerald-700 ring-emerald-200"}`}>
          {d.findings.length ? `${d.findings.length} issues found` : "no issues"}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Detected from the schedule — capacity overloads, oversized jobs, over-stacked teams and gaps.
      </p>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Stat label="Capacity overloads" value={d.capacityOverloads} bad={d.capacityOverloads > 0} />
        <Stat label="Unassigned" value={d.unassignedCount} bad={d.unassignedCount > 0} />
        <Stat label="Intercity" value={d.intercityCount} />
      </div>

      <div className="mt-4 space-y-2">
        {d.findings.length === 0 && <div className="text-sm text-slate-500">No problems detected in the manual plan.</div>}
        {d.findings.map((f, i) => (
          <div key={i} className={`rounded-lg border px-3 py-2 ${TONE[f.severity]}`}>
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${DOT[f.severity]}`} />
              <span className="text-sm font-medium">{f.title}</span>
            </div>
            <p className="mt-1 pl-4 text-xs leading-relaxed opacity-90">{f.detail}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Stat({ label, value, bad }: { label: string; value: number; bad?: boolean }) {
  return (
    <div className="rounded-lg bg-slate-50 p-2.5">
      <div className={`text-xl font-bold ${bad ? "text-red-600" : "text-slate-900"}`}>{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}
