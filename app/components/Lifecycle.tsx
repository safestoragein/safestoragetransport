"use client";

import { Fragment } from "react";

export interface StepTop { ref?: string; name?: string; phone?: string }
export interface LifeStep { label: string; done: boolean; at?: string | null; sub?: string; top?: StepTop }

// Vendor-wise activity chain. Each node shows WHO/WHAT above the circle (order no, customer name,
// number — or warehouse + load) and the ACTION below. The first not-done node is the CURRENT step
// and is called out with a "Next up" tag + a filled amber circle so the eye lands on it instantly.
// Completed steps are solid green (with a tick); upcoming steps are grey and numbered. `done` flags
// come from the live WMS / pickup / delivery feed.
export default function Lifecycle({ steps }: { steps: LifeStep[] }) {
  const n = steps.length;
  const activeIdx = steps.findIndex((s) => !s.done); // -1 → all done

  return (
    <div className="overflow-x-auto pb-1">
      <div className="flex min-w-max items-start">
        {steps.map((s, i) => {
          const active = i === activeIdx;
          const done = s.done;
          return (
            <Fragment key={s.label + i}>
              <div className="flex w-32 flex-col items-center px-1 text-center">
                {/* "Next up" tag — fixed-height slot so every column lines up */}
                <div className="mb-1 flex h-4 items-end">
                  {active && (
                    <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white shadow-sm">
                      Next up
                    </span>
                  )}
                </div>
                {/* ABOVE the circle: order no / name / number (or warehouse + load) */}
                <div className="mb-1 flex h-12 flex-col items-center justify-end leading-tight">
                  {s.top?.ref && <div className={`text-xs font-bold ${active ? "text-slate-900" : "text-slate-800"}`}>{s.top.ref}</div>}
                  {s.top?.name && <div className="max-w-[7.5rem] truncate text-[11px] text-slate-600">{s.top.name}</div>}
                  {s.top?.phone && <div className="text-[11px] text-slate-400">{s.top.phone}</div>}
                </div>
                {/* The node: green tick (done) · filled amber (current) · grey numbered (upcoming) */}
                {done ? (
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="m5 13 4 4L19 7" /></svg>
                  </span>
                ) : active ? (
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-400 text-sm font-bold text-white ring-4 ring-amber-100 shadow">
                    {i + 1}
                  </span>
                ) : (
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-sm font-semibold text-slate-400 ring-2 ring-slate-200">
                    {i + 1}
                  </span>
                )}
                {/* BELOW the circle: action */}
                <span className={`mt-2 text-xs font-semibold leading-tight ${done ? "text-emerald-700" : active ? "text-amber-600" : "text-slate-400"}`}>{s.label}</span>
                {s.sub && <span className={`text-[10px] ${active ? "text-amber-500" : "text-slate-400"}`}>{s.sub}</span>}
                {s.at && <span className="text-[11px] text-slate-400">{s.at}</span>}
              </div>
              {/* Connector — filled green once the step on its left is done, so the row reads like a progress bar */}
              {i < n - 1 && <div className={`h-1 w-10 shrink-0 rounded ${done ? "bg-emerald-400" : "bg-slate-200"}`} style={{ marginTop: "90px" }} />}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
