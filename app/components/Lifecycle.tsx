"use client";

import { Fragment } from "react";

export interface LifeStep { label: string; at?: string | null }

// Horizontal lifecycle tracker (monitoring). `current` is the 1-based step in progress: earlier
// steps render done (green check + timestamp), the current one pulses, later ones are pending.
export default function Lifecycle({ steps, current }: { steps: LifeStep[]; current: number }) {
  const n = steps.length;
  const cur = Math.min(Math.max(current, 1), n);
  const label = steps[cur - 1]?.label ?? "";
  return (
    <div className="rounded-xl border border-slate-200 border-l-4 border-l-emerald-500 bg-white p-4">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-sm">
          <span className="font-bold uppercase tracking-wide text-orange-600">Lifecycle</span>
          <span className="ml-2 text-slate-500">Step {cur} of {n} — <span className="font-medium text-slate-700">{label}</span></span>
        </div>
        <div className="text-sm font-medium text-slate-400">{cur}/{n}</div>
      </div>

      <div className="flex items-start">
        {steps.map((s, i) => {
          const idx = i + 1;
          const done = idx < cur;
          const active = idx === cur;
          return (
            <Fragment key={s.label + i}>
              <div className="flex w-0 flex-1 flex-col items-center text-center">
                {done ? (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-white">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="m5 13 4 4L19 7" /></svg>
                  </span>
                ) : active ? (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white ring-2 ring-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.15)]">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  </span>
                ) : (
                  <span className="h-8 w-8 rounded-full bg-white ring-2 ring-slate-200" />
                )}
                <span className={`mt-2 px-1 text-xs leading-tight ${done || active ? "font-semibold text-emerald-700" : "text-slate-400"}`}>{s.label}</span>
                {s.at && <span className="mt-0.5 text-[11px] text-slate-400">{s.at}</span>}
              </div>
              {idx < n && <div className={`mt-4 h-0.5 flex-1 rounded ${done ? "bg-emerald-400" : "bg-slate-200"}`} />}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
