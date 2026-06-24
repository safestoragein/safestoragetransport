"use client";

// Shared left rail used by every module so the navigation is always visible and the modules
// feel like one app (not separate pages).
export default function Sidebar({ active }: { active: "pr" | "admin" }) {
  const item = (label: string, sub: string, key: string, href: string) => (
    <a href={href} className={`block rounded-lg px-3 py-2.5 ${active === key ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`}>
      <span className="block text-sm font-semibold">{label}</span>
      <span className={`text-xs ${active === key ? "text-slate-300" : "text-slate-400"}`}>{sub}</span>
    </a>
  );
  return (
    <aside className="shrink-0 border-b border-slate-200 bg-white p-4 lg:w-60 lg:border-b-0 lg:border-r">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold text-white">SS</div>
        <div className="text-sm font-bold text-slate-900">SafeStorage Transport</div>
      </div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Modules</div>
      <div className="grid grid-cols-2 gap-1 lg:grid-cols-1">
        {item("Pickup & Retrieval", "schedule · vendors · history", "pr", "/")}
        <div className="rounded-lg px-3 py-2.5 text-slate-300">
          <span className="block text-sm font-semibold">More modules</span>
          <span className="text-xs">coming soon</span>
        </div>
      </div>
    </aside>
  );
}
