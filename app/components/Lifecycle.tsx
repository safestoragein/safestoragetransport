"use client";

import { Fragment } from "react";

export interface StepTop { ref?: string; name?: string; phone?: string }
export interface LifeStep { label: string; done: boolean; at?: string | null; sub?: string; top?: StepTop }

// Vendor-wise activity chain. Each node shows WHO/WHAT above the circle (order no, customer name,
// number — or warehouse + load) and the ACTION below. Done = green; the first not-done node is
// active (amber); the rest grey. `done` flags come from the WMS / pickup / delivery events.
export default function Lifecycle({ steps }: { steps: LifeStep[] }) {
  const n = steps.length;
  const activeIdx = steps.findIndex((s) => !s.done); // -1 → all done
  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-max items-start">
        {steps.map((s, i) => {
          const active = i === activeIdx;
          return (
            <Fragment key={s.label + i}>
              <div className="flex w-32 flex-col items-center px-1 text-center">
                {/* ABOVE the circle: order no / name / number (or warehouse + load) */}
                <div className="mb-1 flex h-12 flex-col items-center justify-end leading-tight">
                  {s.top?.ref && <div className="text-xs font-bold text-slate-800">{s.top.ref}</div>}
                  {s.top?.name && <div className="max-w-[7.5rem] truncate text-[11px] text-slate-600">{s.top.name}</div>}
                  {s.top?.phone && <div className="text-[11px] text-slate-400">{s.top.phone}</div>}
                </div>
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
                {/* BELOW the circle: action */}
                <span className={`mt-2 text-xs font-semibold leading-tight ${s.done ? "text-emerald-700" : active ? "text-amber-600" : "text-slate-400"}`}>{s.label}</span>
                {s.sub && <span className="text-[10px] text-slate-400">{s.sub}</span>}
                {s.at && <span className="text-[11px] text-slate-400">{s.at}</span>}
              </div>
              {i < n - 1 && <div className={`h-0.5 w-10 shrink-0 rounded ${s.done ? "bg-emerald-400" : "bg-slate-200"}`} style={{ marginTop: "68px" }} />}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
