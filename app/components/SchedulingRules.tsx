import AppShell from "./AppShell";
import { Card } from "./ui";
import { SessionUser } from "@/lib/auth";

const SECTIONS: { title: string; note?: string; rules: string[] }[] = [
  {
    title: "Which vendor gets an order (allocation)",
    rules: [
      "Only ACTIVE vendors are scheduled — anyone toggled Inactive in the Vendor panel is skipped.",
      "Hard priority: every priority-A vendor is filled before any B is used, then C, then ungrouped. (Set the group per vendor in the Vendor panel.)",
      "Proximity: each order goes to the nearest vendor cluster — its start point plus the stops it already holds. A vendor is never sent to a far locality just to top off a load.",
      "Max 2 trips per vendor per day. A 3rd trip is never auto-assigned — the team adds it manually only when the leftovers are genuinely on the way.",
      "Vehicle capacity: 14ft = 7 pallets (up to ~9 with tolerance), 10ft = 4 (up to ~6). Two customers can share one trip if their combined pallets fit.",
      "Same-window spread: two orders wanting the same time window are pushed onto different vendors so both can be met.",
      "Intercity orders (pickup or retrieval) never mix with local vendors — they go to the “team to assign” bucket at the end, where the team picks an intercity vendor.",
    ],
  },
  {
    title: "When each stop happens (the day plan)",
    rules: [
      "Retrievals are collected from the warehouse the evening before and delivered in the MORNING.",
      "Pickups are done in the AFTERNOON (each pickup needs ~4 hours of packing + loading).",
      "Customer requests always win: if a customer asks for a morning slot, that stop is scheduled in the morning regardless of the default.",
      "Stops are ordered by the customer’s requested time; any stop that can’t meet its window is flagged LATE (red).",
      "Travel times and distances are real road values from OSRM, not straight-line estimates.",
    ],
  },
  {
    title: "Distance (km)",
    rules: [
      "The day’s total km adds every leg: warehouse → vendor start (evening collection), start → each retrieval delivery, → each pickup, and finally → warehouse to drop the pickups.",
      "Each step in a vendor’s Details → Day plan shows its own km, with the day total at the top.",
    ],
  },
  {
    title: "Cost",
    rules: [
      "₹7,000 per trip block — one vehicle on the road, carrying up to its capacity.",
      "₹800 per added resource (an extra helper), added manually per vendor for the day.",
      "Packing material is charged per pallet on pickups (set the rate in the Vendor panel).",
    ],
  },
];

export default function SchedulingRules({ user }: { user: SessionUser | null }) {
  return (
    <AppShell active="rules" user={user}>
      <div className="mb-4">
        <h1 className="text-lg font-bold text-slate-900">Scheduling rules</h1>
        <p className="text-xs text-slate-500">The exact logic the system follows when it builds a schedule — read-only, for reference.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {SECTIONS.map((s) => (
          <Card key={s.title} className="p-5">
            <h2 className="mb-3 text-sm font-bold text-slate-800">{s.title}</h2>
            <ul className="space-y-2">
              {s.rules.map((r, i) => (
                <li key={i} className="flex gap-2 text-sm text-slate-600">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
      <p className="mt-4 text-xs text-slate-400">Allocation rules apply when you press “Generate / refresh”. The day plan (timing &amp; km) recomputes every time a schedule is opened.</p>
    </AppShell>
  );
}
