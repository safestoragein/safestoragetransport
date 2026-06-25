"use client";

import { Fragment } from "react";

export interface LifeStep { label: string; done: boolean; at?: string | null }

// Operational tracker for one booking. Each step carries its own `done` flag (set from the WMS /
// pickup / delivery events). Done steps are green; the first not-done step is the active one; the
// rest are grey. No payment/admin steps — this is purely the on-ground flow.
export default function Lifecycle({ steps }: { steps: LifeStep[] }) {
  const n = steps.length;
  const activeIdx = steps.findIndex((s) => !s.done); // -1 → all done
  const cur = activeIdx === -1 ? n : activeIdx + 1;
  const label = activeIdx === -1 ? "All done" : steps[activeIdx].label;
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-xs">
          <span className="font-bold uppercase tracking-wide text-orange-600">Status</span>
          <span className="ml-2 text-slate-500">Step {cur} of {n} — <span className="font-medium text-slate-700">{label}</span></span>
        </div>
        <div className="text-xs font-medium text-slate-400">{steps.filter((s) => s.done).length}/{n}</div>
      </div>

      <div className="flex items-start">
        {steps.map((s, i) => {
          const active = i === activeIdx;
          return (
            <Fragment key={s.label + i}>
              <div className="flex w-0 flex-1 flex-col items-center text-center">
                {s.done ? (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-white">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="m5 13 4 4L19 7" /></svg>
                  </span>
                ) : active ? (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white ring-2 ring-amber-400 shadow-[0_0_0_4px_rgba(251,191,36,0.15)]">
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                  </span>
                ) : (
                  <span className="h-8 w-8 rounded-full bg-white ring-2 ring-slate-200" />
                )}
                <span className={`mt-2 px-1 text-xs leading-tight ${s.done ? "font-semibold text-emerald-700" : active ? "font-semibold text-amber-600" : "text-slate-400"}`}>{s.label}</span>
                {s.at && <span className="mt-0.5 text-[11px] text-slate-400">{s.at}</span>}
              </div>
              {i < n - 1 && <div className={`mt-4 h-0.5 flex-1 rounded ${s.done ? "bg-emerald-400" : "bg-slate-200"}`} />}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
