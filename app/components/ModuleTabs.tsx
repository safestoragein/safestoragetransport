"use client";

// The three tabs that live INSIDE the Pickup & Retrieval module.
//   Dashboard    — per-city / per-date analysis (overview, P&L, map, …)
//   Schedule     — tomorrow's optimised schedule across ALL cities
//   Vendor panel — the vendor master (teams, pricing, vehicles)
export default function ModuleTabs({ active }: { active: "dashboard" | "schedule" | "vendors" }) {
  const tabs = [
    { id: "schedule", label: "Schedule", href: "/?view=schedule" },
    { id: "vendors", label: "Vendor panel", href: "/?view=vendors" },
    { id: "dashboard", label: "Old schedules", href: "/?view=dashboard" },
  ] as const;
  return (
    <div className="mb-5 flex gap-1 border-b border-slate-200">
      {tabs.map((t) => (
        <a
          key={t.id}
          href={t.href}
          className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
            active === t.id ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          {t.label}
        </a>
      ))}
    </div>
  );
}
