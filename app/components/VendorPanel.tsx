"use client";

import { useEffect, useState } from "react";
import { VendorMaster } from "@/lib/vendors";
import { money } from "@/lib/format";
import { Card } from "./ui";
import { SessionUser } from "@/lib/auth";
import AppShell from "./AppShell";

const VEHICLE_LABEL: Record<string, string> = { "14ft": "14ft · 7 pallets", "10ft": "10ft · 4 pallets", others: "Other · 7 pallets" };
const TIER_BADGE: Record<string, string> = { general: "bg-blue-50 text-blue-700 ring-blue-200", non_general: "bg-amber-50 text-amber-700 ring-amber-200" };
const TIER_LABEL: Record<string, string> = { general: "General", non_general: "Non-general" };
const PRIORITY_BADGE: Record<string, string> = { A: "bg-emerald-100 text-emerald-700", B: "bg-amber-100 text-amber-700", C: "bg-slate-100 text-slate-600" };

type Sup = { name: string; phone: string };
const primarySup = (v: VendorMaster): Sup | null =>
  (v.supervisors && v.supervisors[0]) || (v.supervisorName ? { name: v.supervisorName, phone: v.supervisorContact || "" } : null);

export default function VendorPanel({ initial, source, user }: { initial: VendorMaster[]; source: "supabase" | "seed"; user: SessionUser | null }) {
  const [vendors, setVendors] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showAll, setShowAll] = useState(false); // reveal the secondary columns
  const [exp, setExp] = useState<{ id: string; mode: "details" | "edit" } | null>(null);
  const toggle = (id: string, mode: "details" | "edit") =>
    setExp((e) => (e && e.id === id && e.mode === mode ? null : { id, mode }));
  const canEdit = user?.role === "admin";
  const onSaved = (u: VendorMaster) => { setVendors((arr) => arr.map((x) => (x.id === u.id ? u : x))); setExp(null); };

  const cities = [...new Set(vendors.map((v) => v.city))].sort();
  const [cityFilter, setCityFilter] = useState("All");
  const shown = cityFilter === "All" ? vendors : vendors.filter((v) => v.city === cityFilter);

  const stats = {
    total: shown.length,
    active: shown.filter((v) => v.active !== false).length,
    general: shown.filter((v) => v.tier === "general").length,
    intercity: shown.filter((v) => v.isIntercityVendor).length,
    local: shown.filter((v) => v.doesLocal).length,
    dailyCost: shown.reduce((s, v) => s + (v.dailyPrice || 0), 0),
    cities: new Set(shown.map((v) => v.city)).size,
  };

  type SortKey = "city" | "name" | "vehicleType" | "tier" | "startingPoint" | "dailyPrice" | "isIntercityVendor" | "doesLocal";
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const toggleSort = (key: SortKey) => setSort((s) => (s && s.key === key ? { key, dir: (s.dir === 1 ? -1 : 1) as 1 | -1 } : { key, dir: 1 }));
  const sortVal = (v: VendorMaster, k: SortKey): string | number => {
    if (k === "dailyPrice") return v.dailyPrice ?? v.perTransaction ?? -1;
    if (k === "isIntercityVendor") return v.isIntercityVendor ? 1 : 0;
    if (k === "doesLocal") return v.doesLocal ? 1 : 0;
    return ((v[k] as string | null) ?? "").toString().toLowerCase();
  };
  const sorted = sort
    ? [...shown].sort((a, b) => {
        const av = sortVal(a, sort.key), bv = sortVal(b, sort.key);
        const r = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
        return r * sort.dir;
      })
    : shown;
  const header = (label: string, key: SortKey) => (
    <th className="px-3 py-2 font-medium">
      <button onClick={() => toggleSort(key)} className="flex items-center gap-1 hover:text-slate-700">
        {label}<span className="text-[10px] text-slate-400">{sort?.key === key ? (sort.dir === 1 ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );

  // Packing-material cost per pallet — global setting.
  const [packing, setPacking] = useState<number | null>(null);
  const [packingDraft, setPackingDraft] = useState("");
  const [savingPacking, setSavingPacking] = useState(false);
  useEffect(() => {
    fetch("/api/settings").then((x) => x.json()).then((s) => {
      if (typeof s.packingPerPallet === "number") { setPacking(s.packingPerPallet); setPackingDraft(String(s.packingPerPallet)); }
    }).catch(() => {});
  }, []);
  const packingDirty = packing !== null && packingDraft !== String(packing);
  async function savePacking() {
    const v = Number(packingDraft);
    if (!Number.isFinite(v) || v < 0) return;
    setSavingPacking(true);
    const r = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ packingPerPallet: v }) }).then((x) => x.json());
    if (r.ok) setPacking(r.packingPerPallet);
    setSavingPacking(false);
  }

  async function patchVendor(v: VendorMaster, patch: Partial<VendorMaster>) {
    setBusy(v.id);
    setVendors((arr) => arr.map((x) => (x.id === v.id ? { ...x, ...patch } : x))); // optimistic
    const r = await fetch("/api/vendors", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: v.id, ...patch }) })
      .then((x) => x.json()).catch(() => ({ ok: false, error: "network error" }));
    if (r && r.ok === false) {
      setVendors((arr) => arr.map((x) => (x.id === v.id ? v : x))); // revert
      const dup = /duplicate|uq_|unique/i.test(r.error || "");
      alert(dup
        ? `${v.name} already has a separate ${patch.vehicleType ?? "record"} entry in ${v.city}. Vendors with two vehicle sizes are kept as two rows — edit that other row instead.`
        : (r.error || "Could not save the change."));
    }
    setBusy(null);
  }
  async function onDelete(v: VendorMaster) {
    if (!window.confirm(`Delete vendor "${v.name}" (${v.city})? This cannot be undone.`)) return;
    setBusy(v.id);
    await fetch(`/api/vendors?id=${encodeURIComponent(v.id)}`, { method: "DELETE" });
    setVendors((arr) => arr.filter((x) => x.id !== v.id));
    setExp(null); setBusy(null);
  }

  return (
    <AppShell active="vendors" user={user}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Vendor panel</h1>
          <p className="text-xs text-slate-500">
            {vendors.length} vendors ·{" "}
            <span className={source === "supabase" ? "font-medium text-emerald-600" : "text-amber-600"}>
              {source === "supabase" ? "live from Supabase" : "static seed (Supabase not connected)"}
            </span>
          </p>
        </div>
        <button onClick={() => setShowAdd((s) => !s)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">
          {showAdd ? "Close" : "+ Add vendor"}
        </button>
      </div>

      {showAdd && <AddForm existingCities={cities} onAdded={(vs) => { setVendors((arr) => [...arr, ...vs]); setShowAdd(false); }} />}

      <Card className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-800">Packing material cost</div>
          <div className="text-[11px] text-slate-500">₹ per pallet on pickups · used in every P&amp;L / margin calculation · applies on next schedule generate</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-slate-500">₹</span>
          <input type="number" min={0} value={packingDraft} onChange={(e) => setPackingDraft(e.target.value)} className="w-28 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-800" placeholder="2000" />
          <span className="text-sm text-slate-500">/ pallet</span>
          <button onClick={savePacking} disabled={!packingDirty || savingPacking} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">{savingPacking ? "Saving…" : "Save"}</button>
        </div>
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: "Vendors", value: stats.total },
          { label: "Active", value: stats.active },
          { label: "Cities", value: stats.cities },
          { label: "Does local", value: stats.local },
          { label: "Intercity", value: stats.intercity },
          { label: "Daily cost", value: money(stats.dailyCost) },
        ].map((s) => (
          <Card key={s.label} className="p-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{s.label}</div>
            <div className="mt-0.5 text-lg font-bold text-slate-900">{s.value}</div>
          </Card>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="text-xs font-medium text-slate-500">City</label>
        <select value={cityFilter} onChange={(e) => setCityFilter(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700">
          <option value="All">All cities ({vendors.length})</option>
          {cities.map((c) => <option key={c} value={c}>{c} ({vendors.filter((v) => v.city === c).length})</option>)}
        </select>
        <button onClick={() => setShowAll((s) => !s)} className="ml-auto rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50">
          {showAll ? "− Fewer columns" : "+ More columns"}
        </button>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs text-slate-500">
                {header("City", "city")}
                {header("Vendor", "name")}
                {header("Vehicle", "vehicleType")}
                {header("Tier", "tier")}
                <th className="px-3 py-2 font-medium">Priority</th>
                {showAll && header("Starting point", "startingPoint")}
                {header("Daily price", "dailyPrice")}
                {showAll && <th className="px-3 py-2 font-medium">Billing</th>}
                {showAll && <th className="px-3 py-2 font-medium">Supervisor</th>}
                {showAll && <th className="px-3 py-2 font-medium">Notes</th>}
                <th className="px-3 py-2 font-medium">Active</th>
                {header("Local", "doesLocal")}
                {header("Intercity", "isIntercityVendor")}
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((v) => (
                <Row
                  key={v.id} v={v} showAll={showAll}
                  mode={exp?.id === v.id ? exp.mode : null}
                  busy={busy === v.id} canEdit={canEdit}
                  onToggleIntercity={() => patchVendor(v, { isIntercityVendor: !v.isIntercityVendor })}
                  onToggleLocal={() => patchVendor(v, { doesLocal: !v.doesLocal })}
                  onToggleActive={() => patchVendor(v, { active: !(v.active !== false) })}
                  onSetPriority={(g) => patchVendor(v, { priorityGroup: g })}
                  onSetBilling={(c) => patchVendor(v, { billingCycle: c })}
                  onSetVehicle={(vt) => patchVendor(v, { vehicleType: vt as VendorMaster["vehicleType"], palletCapacity: vt === "14ft" ? 7 : vt === "10ft" ? 4 : v.palletCapacity })}
                  onDetails={() => toggle(v.id, "details")}
                  onEdit={() => toggle(v.id, "edit")} onCancelEdit={() => setExp(null)} onSaved={onSaved} onDelete={() => onDelete(v)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="mt-3 text-xs text-slate-400">Toggle <b>Active</b> to include/exclude a vendor from scheduling · set a <b>Priority</b> group (A preferred) · <b>Details</b> shows everything (team, documents, deposit, notes); <b>Edit</b> to change them. Inactive vendors are skipped on the next generate.</p>
    </AppShell>
  );
}

function DocLink({ label, url }: { label: string; url?: string | null }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" title="View document" className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4"><path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8z" /><circle cx="12" cy="12" r="3" /></svg>
          View document
        </a>
      ) : <div className="text-sm text-slate-400">Not uploaded</div>}
    </div>
  );
}

function Row({ v, showAll, mode, busy, canEdit, onToggleIntercity, onToggleLocal, onToggleActive, onSetPriority, onSetBilling, onSetVehicle, onDetails, onEdit, onCancelEdit, onSaved, onDelete }: {
  v: VendorMaster; showAll: boolean; mode: "details" | "edit" | null; busy: boolean; canEdit: boolean;
  onToggleIntercity: () => void; onToggleLocal: () => void; onToggleActive: () => void; onSetPriority: (g: string | null) => void; onSetBilling: (c: string | null) => void; onSetVehicle: (vt: string) => void;
  onDetails: () => void; onEdit: () => void; onCancelEdit: () => void; onSaved: (v: VendorMaster) => void; onDelete: () => void;
}) {
  const open = mode !== null;
  const isActive = v.active !== false;
  const sup0 = primarySup(v);
  const moreSup = v.supervisors ? Math.max(0, v.supervisors.length - 1) : 0;
  return (
    <>
      <tr className={`border-t border-slate-100 hover:bg-slate-50 ${isActive ? "" : "opacity-60"}`}>
        <td className="px-3 py-2.5 text-slate-600">{v.city}</td>
        <td className="cursor-pointer px-3 py-2.5 font-medium text-slate-800" onClick={onDetails}>
          <span className="mr-1 text-slate-400">{open ? "▾" : "▸"}</span>{v.name}
          {v.source === "panel" && <span className="ml-1.5 rounded bg-blue-50 px-1 text-[10px] text-blue-600">added</span>}
        </td>
        <td className="px-3 py-2.5">
          {canEdit ? (
            <select value={v.vehicleType} disabled={busy} onChange={(e) => onSetVehicle(e.target.value)}
              title="Vehicle size — change when the vendor swaps vehicles; sets the pallet cap (14ft→7, 10ft→4)"
              className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-xs font-medium text-slate-700">
              <option value="14ft">14ft (7p)</option>
              <option value="10ft">10ft (4p)</option>
              <option value="others">Other · {v.palletCapacity}p</option>
            </select>
          ) : (
            <span className="text-slate-600">{v.vehicleType === "others" ? `Other · ${v.palletCapacity} pallets` : (VEHICLE_LABEL[v.vehicleType] ?? v.vehicleType)}</span>
          )}
        </td>
        <td className="px-3 py-2.5"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${TIER_BADGE[v.tier] ?? TIER_BADGE.general}`}>{TIER_LABEL[v.tier] ?? v.tier}</span></td>
        <td className="px-3 py-2.5">
          <select value={v.priorityGroup ?? ""} disabled={busy} onChange={(e) => onSetPriority(e.target.value || null)} className={`rounded-md border-0 px-1.5 py-0.5 text-xs font-semibold ${PRIORITY_BADGE[v.priorityGroup ?? ""] ?? "bg-slate-50 text-slate-400"}`}>
            <option value="">—</option><option value="A">A</option><option value="B">B</option><option value="C">C</option>
          </select>
        </td>
        {showAll && <td className="px-3 py-2.5 text-slate-500">{v.startingPoint || "—"}</td>}
        <td className="px-3 py-2.5 text-slate-700">{v.dailyPrice != null ? `${money(v.dailyPrice)}/day` : v.pricingNote || "—"}</td>
        {showAll && (
          <td className="px-3 py-2.5">
            <select value={v.billingCycle ?? ""} disabled={busy} onChange={(e) => onSetBilling(e.target.value || null)} className="rounded-md border-0 bg-slate-50 px-1.5 py-0.5 text-xs font-medium text-slate-600">
              <option value="">—</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
            </select>
          </td>
        )}
        {showAll && <td className="px-3 py-2.5 text-slate-500">{sup0 ? <>{sup0.name}{moreSup > 0 ? <span className="ml-1 text-[10px] text-blue-600">+{moreSup}</span> : null}{sup0.phone ? <span className="block text-xs text-slate-400">{sup0.phone}</span> : null}</> : "—"}</td>}
        {showAll && <td className="max-w-[140px] truncate px-3 py-2.5 text-slate-500" title={v.notes || ""}>{v.notes || "—"}</td>}
        <td className="px-3 py-2.5">
          <button disabled={busy} onClick={onToggleActive} className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${isActive ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-red-50 text-red-600 ring-red-200"}`}>
            {busy ? "…" : isActive ? "Active" : "Inactive"}
          </button>
        </td>
        <td className="px-3 py-2.5">
          <button disabled={busy} onClick={onToggleLocal} className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${v.doesLocal ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-slate-50 text-slate-500 ring-slate-200"}`}>
            {busy ? "…" : v.doesLocal ? "Yes" : "No"}
          </button>
        </td>
        <td className="px-3 py-2.5">
          <button disabled={busy} onClick={onToggleIntercity} className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${v.isIntercityVendor ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-slate-50 text-slate-500 ring-slate-200"}`}>
            {busy ? "…" : v.isIntercityVendor ? "Yes" : "No"}
          </button>
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 text-right">
          {canEdit && <button onClick={onEdit} className={`mr-3 text-xs font-medium hover:underline ${mode === "edit" ? "text-indigo-600" : "text-slate-600 hover:text-slate-900"}`}>Edit</button>}
          <button onClick={onDetails} className="mr-3 text-xs text-blue-600 hover:underline">{mode === "details" ? "Hide" : "Details"}</button>
          {canEdit && <button disabled={busy} onClick={onDelete} className="text-xs font-medium text-red-500 hover:text-red-700 hover:underline">Delete</button>}
        </td>
      </tr>
      {open && (
        <tr className="border-t border-slate-100 bg-slate-50">
          <td colSpan={showAll ? 14 : 10} className="px-3 py-3">
            {mode === "edit" ? (
              <EditForm v={v} onSaved={onSaved} onCancel={onCancelEdit} />
            ) : (
              <div className="grid gap-x-8 gap-y-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
                <div className="sm:col-span-2 lg:col-span-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Supervisors</div>
                  <div className="text-slate-700">{(v.supervisors && v.supervisors.length ? v.supervisors : (sup0 ? [sup0] : [])).map((s, i) => <span key={i} className="mr-3 inline-block">{s.name}{s.phone ? <span className="text-slate-400"> · {s.phone}</span> : null}</span>) || "—"}</div>
                </div>
                <Detail label="Driver" value={v.driverName} sub={v.driverContact} />
                <Detail label="Packers" value={v.packerNames} />
                <Detail label="Vehicle no" value={v.vehicleNo} />
                <Detail label="Starting point" value={v.startingPoint} />
                <Detail label="Vehicle" value={v.vehicleType === "others" ? `Other · ${v.palletCapacity} pallets` : (VEHICLE_LABEL[v.vehicleType] ?? v.vehicleType)} />
                <Detail label="Tier" value={TIER_LABEL[v.tier] ?? v.tier} />
                <Detail label="Priority group" value={v.priorityGroup || null} />
                <Detail label="Billing cycle" value={v.billingCycle ? v.billingCycle[0].toUpperCase() + v.billingCycle.slice(1) : null} />
                <Detail label="Daily price" value={v.dailyPrice != null ? `${money(v.dailyPrice)}/day` : v.pricingNote || null} />
                <Detail label="Pallet capacity" value={`${v.palletCapacity} pallets`} />
                <Detail label="Security deposit" value={v.securityDeposit != null ? money(v.securityDeposit) : null} />
                <Detail label="Mobile app PIN" value={v.appPin || "— not set —"} sub={v.appPin ? "vendor logs in with their phone + this PIN" : null} />
                <DocLink label="Service agreement" url={v.serviceAgreementUrl} />
                <DocLink label="GST document" url={v.gstDocumentUrl} />
                {v.notes && <div className="sm:col-span-2 lg:col-span-3"><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Notes</div><div className="text-slate-700">{v.notes}</div></div>}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function Detail({ label, value, sub }: { label: string; value?: string | null; sub?: string | null }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-slate-700">{value || "—"}{sub ? <span className="ml-1 text-slate-400">· {sub}</span> : null}</div>
    </div>
  );
}

// Repeatable supervisor list (name + phone), up to 10.
function SupervisorsEditor({ value, onChange }: { value: Sup[]; onChange: (v: Sup[]) => void }) {
  const rows = value.length ? value : [{ name: "", phone: "" }];
  const set = (i: number, k: "name" | "phone", val: string) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: val } : r)));
  const add = () => { if (rows.length < 10) onChange([...rows, { name: "", phone: "" }]); };
  const remove = (i: number) => onChange(rows.filter((_, j) => j !== i));
  const input = "w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm";
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <input className={input} placeholder={`Supervisor ${i + 1} name`} value={r.name} onChange={(e) => set(i, "name", e.target.value)} />
          <input className={input} placeholder="Phone" value={r.phone} onChange={(e) => set(i, "phone", e.target.value)} />
          <button type="button" onClick={() => remove(i)} disabled={rows.length === 1} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 ring-1 ring-slate-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-30" title="Remove">−</button>
        </div>
      ))}
      {rows.length < 10 && (
        <button type="button" onClick={add} className="rounded-lg px-2 py-1 text-xs font-medium text-blue-600 ring-1 ring-slate-200 hover:bg-blue-50">+ Add supervisor ({rows.length}/10)</button>
      )}
    </div>
  );
}

// Admin edit.
function EditForm({ v, onSaved, onCancel }: { v: VendorMaster; onSaved: (v: VendorMaster) => void; onCancel: () => void }) {
  const [f, setF] = useState({
    name: v.name ?? "", startingPoint: v.startingPoint ?? "", tier: v.tier,
    dailyPrice: v.dailyPrice != null ? String(v.dailyPrice) : "",
    securityDeposit: v.securityDeposit != null ? String(v.securityDeposit) : "",
    driverName: v.driverName ?? "", driverContact: v.driverContact ?? "",
    packerNames: v.packerNames ?? "", vehicleNo: v.vehicleNo ?? "", systemTeamNo: v.systemTeamNo ?? "",
    othersCapacity: String(v.palletCapacity ?? 7),
    notes: v.notes ?? "", priorityGroup: v.priorityGroup ?? "", billingCycle: v.billingCycle ?? "", isIntercityVendor: v.isIntercityVendor, doesLocal: v.doesLocal, appPin: v.appPin ?? "",
  });
  const [sups, setSups] = useState<Sup[]>(v.supervisors && v.supervisors.length ? v.supervisors : (v.supervisorName ? [{ name: v.supervisorName, phone: v.supervisorContact || "" }] : [{ name: "", phone: "" }]));
  const [saFile, setSaFile] = useState<File | null>(null);
  const [gstFile, setGstFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: string, val: string | boolean) => setF((p) => ({ ...p, [k]: val }));

  async function save() {
    setSaving(true); setErr("");
    try {
      let sa = v.serviceAgreementUrl ?? null, gst = v.gstDocumentUrl ?? null;
      if (saFile) sa = await uploadDoc(v.id, "service_agreement", saFile);
      if (gstFile) gst = await uploadDoc(v.id, "gst", gstFile);
      const cleanSups = sups.filter((s) => s.name.trim() || s.phone.trim()).map((s) => ({ name: s.name.trim(), phone: s.phone.trim() }));
      const patch = {
        id: v.id, name: f.name.trim(), startingPoint: f.startingPoint.trim(), tier: f.tier,
        isIntercityVendor: f.isIntercityVendor, doesLocal: f.doesLocal, appPin: f.appPin.trim() || null, notes: f.notes.trim() || null, priorityGroup: f.priorityGroup || null, billingCycle: f.billingCycle || null,
        dailyPrice: f.dailyPrice === "" ? null : Number(f.dailyPrice),
        securityDeposit: f.securityDeposit === "" ? null : Number(f.securityDeposit),
        driverName: f.driverName.trim() || null, driverContact: f.driverContact.trim() || null,
        packerNames: f.packerNames.trim() || null, vehicleNo: f.vehicleNo.trim() || null, systemTeamNo: f.systemTeamNo.trim() || null,
        ...(v.vehicleType === "others" ? { palletCapacity: Number(f.othersCapacity) } : {}),
        supervisors: cleanSups,
      };
      const r = await fetch("/api/vendors", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      if (!r.ok) throw new Error("Could not save changes");
      onSaved({ ...v, ...patch, supervisors: cleanSups, supervisorName: cleanSups[0]?.name ?? null, supervisorContact: cleanSups[0]?.phone ?? null, serviceAgreementUrl: sa, gstDocumentUrl: gst });
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }

  const input = "w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm";
  const field = (label: string, k: keyof typeof f, type = "text", placeholder = "") => (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-slate-500">{label}</span>
      <input className={input} type={type} placeholder={placeholder} value={f[k] as string} onChange={(e) => set(k, e.target.value)} />
    </label>
  );
  const docField = (label: string, current: string | null | undefined, file: File | null, setFile: (f: File | null) => void) => (
    <label className="block">
      <span className="mb-1 flex items-center gap-2 text-[11px] font-medium text-slate-500">
        {label}
        {current && (
          <a href={current} target="_blank" rel="noreferrer" title="View document" className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-blue-600 ring-1 ring-blue-200 hover:bg-blue-100">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5"><path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8z" /><circle cx="12" cy="12" r="3" /></svg>
            View document
          </a>
        )}
      </span>
      <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="w-full text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white" />
      {file
        ? <span className="mt-1 block text-[11px] text-emerald-600">{file.name} — {current ? "will REPLACE the current file" : "will upload"} on save</span>
        : current && <span className="mt-1 block text-[11px] text-slate-400">A file is on record — choose a new one to replace it.</span>}
    </label>
  );

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 text-sm font-semibold text-slate-700">Edit {v.name}</div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {field("Vendor name", "name")}
        {field("Starting point", "startingPoint")}
        <label className="block"><span className="mb-1 block text-[11px] font-medium text-slate-500">Tier</span>
          <select className={input} value={f.tier} onChange={(e) => set("tier", e.target.value)}><option value="general">General</option><option value="non_general">Non-general</option></select>
        </label>
        <label className="block"><span className="mb-1 block text-[11px] font-medium text-slate-500">Priority group</span>
          <select className={input} value={f.priorityGroup} onChange={(e) => set("priorityGroup", e.target.value)}><option value="">— none —</option><option value="A">A (preferred)</option><option value="B">B</option><option value="C">C</option></select>
        </label>
        <label className="block"><span className="mb-1 block text-[11px] font-medium text-slate-500">Billing cycle</span>
          <select className={input} value={f.billingCycle} onChange={(e) => set("billingCycle", e.target.value)}><option value="">— none —</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select>
        </label>
        {field("Daily price (₹)", "dailyPrice", "number")}
        {field("Security deposit (₹)", "securityDeposit", "number", "e.g. 25000")}
        {field("Driver name", "driverName")}
        {field("Driver contact", "driverContact")}
        {field("Packers", "packerNames")}
        {field("Vehicle no", "vehicleNo")}
        {v.vehicleType === "others" && (
          <label className="block"><span className="mb-1 block text-[11px] font-medium text-slate-500">Other vehicle capacity</span>
            <select className={input} value={f.othersCapacity} onChange={(e) => set("othersCapacity", e.target.value)}>
              <option value="7">7 pallets (behaves like 14ft)</option>
              <option value="4">4 pallets (behaves like 10ft)</option>
            </select>
          </label>
        )}
      </div>

      <div className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Supervisors (up to 10)</div>
      <SupervisorsEditor value={sups} onChange={setSups} />

      <label className="mt-4 block"><span className="mb-1 block text-[11px] font-medium text-slate-500">Vendor notes</span>
        <textarea className={input} rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Anything to remember about this vendor…" />
      </label>

      <div className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Documents</div>
      <div className="grid gap-3 sm:grid-cols-2">
        {docField("Service agreement", v.serviceAgreementUrl, saFile, setSaFile)}
        {docField("GST document", v.gstDocumentUrl, gstFile, setGstFile)}
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={f.isIntercityVendor} onChange={(e) => set("isIntercityVendor", e.target.checked)} /> Intercity vendor
      </label>
      <label className="mt-1 flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={f.doesLocal} onChange={(e) => set("doesLocal", e.target.checked)} /> Does local pickup/retrieval <span className="text-xs text-slate-400">(included in local scheduling)</span>
      </label>
      <label className="mt-2 block text-sm text-slate-700">
        <span className="mb-1 block text-xs font-medium text-slate-500">Mobile app PIN <span className="text-slate-400">(vendor logs in with their phone + this PIN)</span></span>
        <input value={f.appPin} onChange={(e) => set("appPin", e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder="e.g. 1234" className="w-40 rounded-lg border border-slate-200 px-3 py-1.5 text-sm" />
      </label>

      {err && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 ring-1 ring-red-200">⚠ {err}</div>}
      <div className="mt-3 flex gap-2">
        <button onClick={save} disabled={saving} className="rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">{saving ? "Saving…" : "Save changes"}</button>
        <button onClick={onCancel} disabled={saving} className="rounded-lg px-4 py-1.5 text-sm font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50">Cancel</button>
      </div>
    </div>
  );
}

async function uploadDoc(vendorId: string, kind: "service_agreement" | "gst", file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file); fd.append("vendorId", vendorId); fd.append("kind", kind);
  const r = await fetch("/api/vendors/upload", { method: "POST", body: fd });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || "upload failed");
  return j.url as string;
}

const EMPTY = {
  name: "", vehicleType: "14ft", othersCapacity: "7", tier: "general", startingPoint: "", dailyPrice: "", pricingNote: "", securityDeposit: "",
  driverName: "", driverContact: "", packerNames: "", vehicleNo: "", vehicleName: "", systemTeamNo: "", remarks: "",
  notes: "", priorityGroup: "", billingCycle: "", isIntercityVendor: false, doesLocal: true, appPin: "",
};

function AddForm({ existingCities, onAdded }: { existingCities: string[]; onAdded: (v: VendorMaster[]) => void }) {
  const [f, setF] = useState({ ...EMPTY });
  const [selCities, setSelCities] = useState<string[]>([]);
  const [newCity, setNewCity] = useState("");
  const [sups, setSups] = useState<Sup[]>([{ name: "", phone: "" }]);
  const [saFile, setSaFile] = useState<File | null>(null);
  const [gstFile, setGstFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: string, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));
  const toggleCity = (c: string) => setSelCities((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]));
  const addNewCity = () => { const c = newCity.trim(); if (c && !selCities.includes(c)) setSelCities((s) => [...s, c]); setNewCity(""); };

  async function submit() {
    if (!f.name || selCities.length === 0) { setErr("Vendor name and at least one city are required"); return; }
    setSaving(true); setErr("");
    try {
      const cleanSups = sups.filter((s) => s.name.trim() || s.phone.trim()).map((s) => ({ name: s.name.trim(), phone: s.phone.trim() }));
      const res = await fetch("/api/vendors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...f, palletCapacity: f.vehicleType === "others" ? Number(f.othersCapacity) : null, cities: selCities, supervisors: cleanSups }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Could not save vendor");
      const { vendors } = j;
      // upload documents to the FIRST created record (one set of docs per add)
      if ((saFile || gstFile) && vendors[0]) {
        if (saFile) vendors[0].serviceAgreementUrl = await uploadDoc(vendors[0].id, "service_agreement", saFile);
        if (gstFile) vendors[0].gstDocumentUrl = await uploadDoc(vendors[0].id, "gst", gstFile);
      }
      onAdded(vendors);
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }

  const input = "w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm";
  const field = (label: string, k: string, type = "text", placeholder = "", req = false) => (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-slate-500">{label}{req && <span className="text-red-500"> *</span>}</span>
      <input className={input} type={type} placeholder={placeholder} value={(f as unknown as Record<string, string>)[k]} onChange={(e) => set(k, e.target.value)} />
    </label>
  );

  return (
    <Card className="mb-4 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-700">Add a new vendor</span>
        <span className="text-[11px] text-slate-400"><span className="text-red-500">*</span> required</span>
      </div>

      {/* cities — multi-select; one record is created per selected city */}
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Cities <span className="text-red-500">*</span> (select at least one — one record created per city)</div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {existingCities.map((c) => (
          <button key={c} type="button" onClick={() => toggleCity(c)} className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ${selCities.includes(c) ? "bg-blue-600 text-white ring-blue-600" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"}`}>{c}</button>
        ))}
        <span className="flex items-center gap-1">
          <input className="w-32 rounded-lg border border-slate-200 px-2 py-1 text-xs" placeholder="+ new city" value={newCity} onChange={(e) => setNewCity(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNewCity(); } }} />
          <button type="button" onClick={addNewCity} className="rounded-lg px-2 py-1 text-xs font-medium text-blue-600 ring-1 ring-slate-200 hover:bg-blue-50">Add</button>
        </span>
      </div>
      {selCities.length > 0 && <div className="mb-3 text-[11px] text-slate-500">Will create <b>{selCities.length}</b> record{selCities.length > 1 ? "s" : ""}: {selCities.join(", ")}</div>}

      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Vendor &amp; pricing</div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {field("Vendor name", "name", "text", "e.g. VMS Packers Team 1", true)}
        <label className="block"><span className="mb-1 block text-[11px] font-medium text-slate-500">Vehicle <span className="text-red-500">*</span></span>
          <select className={input} value={f.vehicleType} onChange={(e) => { const vt = e.target.value; setF((p) => ({ ...p, vehicleType: vt, tier: vt === "others" ? "non_general" : p.tier })); }}>
            <option value="14ft">14ft (7 pallets)</option><option value="10ft">10ft (4 pallets)</option><option value="others">Other</option>
          </select>
        </label>
        {f.vehicleType === "others" && (
          <label className="block"><span className="mb-1 block text-[11px] font-medium text-slate-500">Other vehicle capacity <span className="text-red-500">*</span></span>
            <select className={input} value={f.othersCapacity} onChange={(e) => set("othersCapacity", e.target.value)}>
              <option value="7">7 pallets (behaves like 14ft)</option>
              <option value="4">4 pallets (behaves like 10ft)</option>
            </select>
          </label>
        )}
        <label className="block"><span className="mb-1 block text-[11px] font-medium text-slate-500">Tier</span>
          <select className={input} value={f.tier} onChange={(e) => set("tier", e.target.value)}><option value="general">General (pay daily regardless)</option><option value="non_general">Non-general (premium / on-demand)</option></select>
        </label>
        <label className="block"><span className="mb-1 block text-[11px] font-medium text-slate-500">Priority group</span>
          <select className={input} value={f.priorityGroup} onChange={(e) => set("priorityGroup", e.target.value)}><option value="">— none —</option><option value="A">A (preferred)</option><option value="B">B</option><option value="C">C</option></select>
        </label>
        <label className="block"><span className="mb-1 block text-[11px] font-medium text-slate-500">Billing cycle</span>
          <select className={input} value={f.billingCycle} onChange={(e) => set("billingCycle", e.target.value)}><option value="">— none —</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select>
        </label>
        {field("Starting point (locality)", "startingPoint", "text", "e.g. Akshaya Nagar")}
        {field("Daily price (₹)", "dailyPrice", "number", "e.g. 7500")}
        {field("Pricing note (for non-general)", "pricingNote", "text", "e.g. 6 transactions / ₹20,000")}
        {field("Security deposit (₹)", "securityDeposit", "number", "e.g. 25000")}
      </div>

      <div className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Supervisors (up to 10)</div>
      <SupervisorsEditor value={sups} onChange={setSups} />

      <div className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Team &amp; vehicle</div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {field("Driver name", "driverName")}
        {field("Driver contact", "driverContact")}
        {field("Packers", "packerNames", "text", "comma-separated")}
        {field("Vehicle no", "vehicleNo", "text", "e.g. KA51AJ4776")}
        {field("Vehicle name", "vehicleName")}
      </div>

      <label className="mt-4 block"><span className="mb-1 block text-[11px] font-medium text-slate-500">Vendor notes</span>
        <textarea className={input} rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Anything to remember about this vendor…" />
      </label>

      <div className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Documents</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="mb-1 block text-[11px] font-medium text-slate-500">Service agreement</span>
          <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={(e) => setSaFile(e.target.files?.[0] ?? null)} className="w-full text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white" />
          {saFile && <span className="mt-1 block text-[11px] text-emerald-600">{saFile.name}</span>}
        </label>
        <label className="block"><span className="mb-1 block text-[11px] font-medium text-slate-500">GST document</span>
          <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={(e) => setGstFile(e.target.files?.[0] ?? null)} className="w-full text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white" />
          {gstFile && <span className="mt-1 block text-[11px] text-emerald-600">{gstFile.name}</span>}
        </label>
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={f.isIntercityVendor} onChange={(e) => set("isIntercityVendor", e.target.checked)} /> Intercity vendor
      </label>
      <label className="mt-1 flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={f.doesLocal} onChange={(e) => set("doesLocal", e.target.checked)} /> Does local pickup/retrieval <span className="text-xs text-slate-400">(included in local scheduling)</span>
      </label>
      <label className="mt-2 block text-sm text-slate-700">
        <span className="mb-1 block text-xs font-medium text-slate-500">Mobile app PIN <span className="text-slate-400">(vendor logs in with their phone + this PIN)</span></span>
        <input value={f.appPin} onChange={(e) => set("appPin", e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder="e.g. 1234" className="w-40 rounded-lg border border-slate-200 px-3 py-1.5 text-sm" />
      </label>

      {err && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 ring-1 ring-red-200">⚠ {err}</div>}
      <button onClick={submit} disabled={saving} className="mt-3 rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">{saving ? "Saving…" : selCities.length > 1 ? `Save ${selCities.length} vendor records` : "Save vendor"}</button>
    </Card>
  );
}
