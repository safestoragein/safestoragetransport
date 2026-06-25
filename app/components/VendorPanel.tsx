"use client";

import { useEffect, useState } from "react";
import { VendorMaster } from "@/lib/vendors";
import { money } from "@/lib/format";
import { Card } from "./ui";
import { SessionUser } from "@/lib/auth";
import AppShell from "./AppShell";

const VEHICLE_LABEL: Record<string, string> = { "14ft": "14ft · 7 pallets", "10ft": "10ft · 4 pallets", others: "Other · 7 pallets" };
const TIER_BADGE: Record<string, string> = {
  general: "bg-blue-50 text-blue-700 ring-blue-200",
  non_general: "bg-amber-50 text-amber-700 ring-amber-200",
};
const TIER_LABEL: Record<string, string> = { general: "General", non_general: "Non-general" };

export default function VendorPanel({ initial, source, user }: { initial: VendorMaster[]; source: "supabase" | "seed"; user: SessionUser | null }) {
  const [vendors, setVendors] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  // One expanded row at a time, in one of three modes.
  const [exp, setExp] = useState<{ id: string; mode: "details" | "compliance" | "edit" } | null>(null);
  const toggle = (id: string, mode: "details" | "compliance" | "edit") =>
    setExp((e) => (e && e.id === id && e.mode === mode ? null : { id, mode }));
  const canEdit = user?.role === "admin";
  const onSaved = (u: VendorMaster) => { setVendors((arr) => arr.map((x) => (x.id === u.id ? u : x))); setExp(null); };

  const cities = [...new Set(vendors.map((v) => v.city))].sort();
  const [cityFilter, setCityFilter] = useState("All");
  const shown = cityFilter === "All" ? vendors : vendors.filter((v) => v.city === cityFilter);

  const stats = {
    total: shown.length,
    general: shown.filter((v) => v.tier === "general").length,
    nonGeneral: shown.filter((v) => v.tier === "non_general").length,
    intercity: shown.filter((v) => v.isIntercityVendor).length,
    dailyCost: shown.reduce((s, v) => s + (v.dailyPrice || 0), 0),
    cities: new Set(shown.map((v) => v.city)).size,
  };

  // Column sorting
  type SortKey = "city" | "name" | "vehicleType" | "tier" | "startingPoint" | "dailyPrice" | "supervisorName" | "isIntercityVendor";
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const toggleSort = (key: SortKey) => setSort((s) => (s && s.key === key ? { key, dir: (s.dir === 1 ? -1 : 1) as 1 | -1 } : { key, dir: 1 }));
  const sortVal = (v: VendorMaster, k: SortKey): string | number => {
    if (k === "dailyPrice") return v.dailyPrice ?? v.perTransaction ?? -1;
    if (k === "isIntercityVendor") return v.isIntercityVendor ? 1 : 0;
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
        {label}
        <span className="text-[10px] text-slate-400">{sort?.key === key ? (sort.dir === 1 ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );

  // Packing-material cost per pallet — global setting that drives P&L cost calculation.
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

  async function toggleIntercity(v: VendorMaster) {
    setBusy(v.id);
    const next = !v.isIntercityVendor;
    await fetch("/api/vendors", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: v.id, isIntercityVendor: next }) });
    setVendors((arr) => arr.map((x) => (x.id === v.id ? { ...x, isIntercityVendor: next } : x)));
    setBusy(null);
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

        {showAdd && <AddForm onAdded={(v) => { setVendors((arr) => [...arr, v]); setShowAdd(false); }} />}

        {/* Packing-material cost per pallet — feeds P&L cost calculation across the app */}
        <Card className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-800">Packing material cost</div>
            <div className="text-[11px] text-slate-500">₹ per pallet on pickups · used in every P&amp;L / margin calculation · applies on next schedule generate</div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm text-slate-500">₹</span>
            <input
              type="number" min={0} value={packingDraft}
              onChange={(e) => setPackingDraft(e.target.value)}
              className="w-28 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-800"
              placeholder="2000"
            />
            <span className="text-sm text-slate-500">/ pallet</span>
            <button onClick={savePacking} disabled={!packingDirty || savingPacking} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
              {savingPacking ? "Saving…" : "Save"}
            </button>
          </div>
        </Card>

        {/* Stat cards (reflect the selected city) */}
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Vendors", value: stats.total },
            { label: "Cities", value: stats.cities },
            { label: "General", value: stats.general },
            { label: "Non-general", value: stats.nonGeneral },
            { label: "Intercity", value: stats.intercity },
            { label: "Daily cost", value: money(stats.dailyCost) },
          ].map((s) => (
            <Card key={s.label} className="p-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{s.label}</div>
              <div className="mt-0.5 text-lg font-bold text-slate-900">{s.value}</div>
            </Card>
          ))}
        </div>

        {/* City dropdown filter */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="text-xs font-medium text-slate-500">City</label>
          <select
            value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700"
          >
            <option value="All">All cities ({vendors.length})</option>
            {cities.map((c) => (
              <option key={c} value={c}>{c} ({vendors.filter((v) => v.city === c).length})</option>
            ))}
          </select>
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
                  {header("Starting point", "startingPoint")}
                  {header("Daily price", "dailyPrice")}
                  {header("Supervisor", "supervisorName")}
                  {header("Intercity", "isIntercityVendor")}
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((v) => (
                  <Row
                    key={v.id} v={v}
                    mode={exp?.id === v.id ? exp.mode : null}
                    busy={busy === v.id} onToggleIntercity={() => toggleIntercity(v)}
                    canEdit={canEdit}
                    onDetails={() => toggle(v.id, "details")} onCompliance={() => toggle(v.id, "compliance")}
                    onEdit={() => toggle(v.id, "edit")} onCancelEdit={() => setExp(null)} onSaved={onSaved}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <p className="mt-3 text-xs text-slate-400">Details = team &amp; vehicle · Compliance = security deposit &amp; documents · Edit (admin) to change details or upload documents. Click the Intercity cell to toggle.</p>
    </AppShell>
  );
}

function DocLink({ label, url }: { label: string; url?: string | null }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
          View document
        </a>
      ) : (
        <div className="text-sm text-slate-400">Not uploaded</div>
      )}
    </div>
  );
}

function Row({ v, mode, busy, onToggleIntercity, canEdit, onDetails, onCompliance, onEdit, onCancelEdit, onSaved }: {
  v: VendorMaster; mode: "details" | "compliance" | "edit" | null; busy: boolean; onToggleIntercity: () => void;
  canEdit: boolean; onDetails: () => void; onCompliance: () => void; onEdit: () => void; onCancelEdit: () => void; onSaved: (v: VendorMaster) => void;
}) {
  const open = mode !== null;
  return (
    <>
      <tr className="border-t border-slate-100 hover:bg-slate-50">
        <td className="px-3 py-2.5 text-slate-600">{v.city}</td>
        <td className="cursor-pointer px-3 py-2.5 font-medium text-slate-800" onClick={onDetails}>
          <span className="mr-1 text-slate-400">{open ? "▾" : "▸"}</span>{v.name}
          {v.source === "panel" && <span className="ml-1.5 rounded bg-blue-50 px-1 text-[10px] text-blue-600">added</span>}
        </td>
        <td className="px-3 py-2.5 text-slate-600">{VEHICLE_LABEL[v.vehicleType] ?? v.vehicleType}</td>
        <td className="px-3 py-2.5"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${TIER_BADGE[v.tier] ?? TIER_BADGE.general}`}>{TIER_LABEL[v.tier] ?? v.tier}</span></td>
        <td className="px-3 py-2.5 text-slate-500">{v.startingPoint || "—"}</td>
        <td className="px-3 py-2.5 text-slate-700">{v.dailyPrice != null ? `${money(v.dailyPrice)}/day` : v.pricingNote || "—"}</td>
        <td className="px-3 py-2.5 text-slate-500">{v.supervisorName ? <>{v.supervisorName}{v.supervisorContact ? <span className="block text-xs text-slate-400">{v.supervisorContact}</span> : null}</> : "—"}</td>
        <td className="px-3 py-2.5">
          <button disabled={busy} onClick={onToggleIntercity} className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${v.isIntercityVendor ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-slate-50 text-slate-500 ring-slate-200"}`}>
            {busy ? "…" : v.isIntercityVendor ? "Yes" : "No"}
          </button>
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 text-right">
          <button onClick={onCompliance} className={`mr-3 text-xs font-medium hover:underline ${mode === "compliance" ? "text-indigo-600" : "text-slate-600 hover:text-slate-900"}`}>Compliance</button>
          {canEdit && <button onClick={onEdit} className={`mr-3 text-xs font-medium hover:underline ${mode === "edit" ? "text-indigo-600" : "text-slate-600 hover:text-slate-900"}`}>Edit</button>}
          <button onClick={onDetails} className="text-xs text-blue-600 hover:underline">{mode === "details" ? "Hide" : "Details"}</button>
        </td>
      </tr>
      {open && (
        <tr className="border-t border-slate-100 bg-slate-50">
          <td colSpan={9} className="px-3 py-3">
            {mode === "edit" ? (
              <EditForm v={v} onSaved={onSaved} onCancel={onCancelEdit} />
            ) : mode === "compliance" ? (
              <div className="grid gap-x-8 gap-y-3 text-xs sm:grid-cols-3">
                <Detail label="Security deposit" value={v.securityDeposit != null ? money(v.securityDeposit) : null} />
                <DocLink label="Service agreement" url={v.serviceAgreementUrl} />
                <DocLink label="GST document" url={v.gstDocumentUrl} />
              </div>
            ) : (
              <div className="grid gap-x-8 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
                <Detail label="Supervisor" value={v.supervisorName} sub={v.supervisorContact} />
                <Detail label="Driver" value={v.driverName} sub={v.driverContact} />
                <Detail label="Packers" value={v.packerNames} />
                <Detail label="Vehicle no" value={v.vehicleNo} />
                <Detail label="System team" value={v.systemTeamNo} />
                <Detail label="Pallet capacity" value={`${v.palletCapacity} pallets`} />
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

// Admin edit: vendor fields + security deposit + upload service-agreement / GST documents.
function EditForm({ v, onSaved, onCancel }: { v: VendorMaster; onSaved: (v: VendorMaster) => void; onCancel: () => void }) {
  const [f, setF] = useState({
    name: v.name ?? "", startingPoint: v.startingPoint ?? "", tier: v.tier,
    dailyPrice: v.dailyPrice != null ? String(v.dailyPrice) : "",
    securityDeposit: v.securityDeposit != null ? String(v.securityDeposit) : "",
    supervisorName: v.supervisorName ?? "", supervisorContact: v.supervisorContact ?? "",
    driverName: v.driverName ?? "", driverContact: v.driverContact ?? "",
    packerNames: v.packerNames ?? "", vehicleNo: v.vehicleNo ?? "", systemTeamNo: v.systemTeamNo ?? "",
    isIntercityVendor: v.isIntercityVendor,
  });
  const [saFile, setSaFile] = useState<File | null>(null);
  const [gstFile, setGstFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: string, val: string | boolean) => setF((p) => ({ ...p, [k]: val }));

  async function upload(kind: "service_agreement" | "gst", file: File): Promise<string> {
    const fd = new FormData();
    fd.append("file", file); fd.append("vendorId", v.id); fd.append("kind", kind);
    const r = await fetch("/api/vendors/upload", { method: "POST", body: fd });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error || "upload failed");
    return j.url as string;
  }

  async function save() {
    setSaving(true); setErr("");
    try {
      let sa = v.serviceAgreementUrl ?? null;
      let gst = v.gstDocumentUrl ?? null;
      if (saFile) sa = await upload("service_agreement", saFile);
      if (gstFile) gst = await upload("gst", gstFile);
      const patch = {
        id: v.id, name: f.name.trim(), startingPoint: f.startingPoint.trim(), tier: f.tier,
        isIntercityVendor: f.isIntercityVendor,
        dailyPrice: f.dailyPrice === "" ? null : Number(f.dailyPrice),
        securityDeposit: f.securityDeposit === "" ? null : Number(f.securityDeposit),
        supervisorName: f.supervisorName.trim() || null, supervisorContact: f.supervisorContact.trim() || null,
        driverName: f.driverName.trim() || null, driverContact: f.driverContact.trim() || null,
        packerNames: f.packerNames.trim() || null, vehicleNo: f.vehicleNo.trim() || null, systemTeamNo: f.systemTeamNo.trim() || null,
      };
      const r = await fetch("/api/vendors", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      if (!r.ok) throw new Error("Could not save changes");
      onSaved({ ...v, ...patch, serviceAgreementUrl: sa, gstDocumentUrl: gst });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
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
      <span className="mb-1 block text-[11px] font-medium text-slate-500">
        {label}
        {current && <a href={current} target="_blank" rel="noreferrer" className="ml-2 text-blue-600 hover:underline">current ↗</a>}
      </span>
      <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="w-full text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white" />
      {file && <span className="mt-1 block text-[11px] text-emerald-600">{file.name} — will upload on save</span>}
    </label>
  );

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 text-sm font-semibold text-slate-700">Edit {v.name}</div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {field("Vendor name", "name")}
        {field("Starting point", "startingPoint")}
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-slate-500">Tier</span>
          <select className={input} value={f.tier} onChange={(e) => set("tier", e.target.value)}>
            <option value="general">General</option>
            <option value="non_general">Non-general</option>
          </select>
        </label>
        {field("Daily price (₹)", "dailyPrice", "number")}
        {field("Security deposit (₹)", "securityDeposit", "number", "e.g. 25000")}
        {field("Supervisor name", "supervisorName")}
        {field("Supervisor contact", "supervisorContact")}
        {field("Driver name", "driverName")}
        {field("Driver contact", "driverContact")}
        {field("Packers", "packerNames")}
        {field("Vehicle no", "vehicleNo")}
        {field("System team", "systemTeamNo")}
      </div>

      <div className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Documents</div>
      <div className="grid gap-3 sm:grid-cols-2">
        {docField("Service agreement", v.serviceAgreementUrl, saFile, setSaFile)}
        {docField("GST document", v.gstDocumentUrl, gstFile, setGstFile)}
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={f.isIntercityVendor} onChange={(e) => set("isIntercityVendor", e.target.checked)} /> Intercity vendor
      </label>

      {err && <div className="mt-2 text-xs text-red-600">{err}</div>}
      <div className="mt-3 flex gap-2">
        <button onClick={save} disabled={saving} className="rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">{saving ? "Saving…" : "Save changes"}</button>
        <button onClick={onCancel} disabled={saving} className="rounded-lg px-4 py-1.5 text-sm font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50">Cancel</button>
      </div>
    </div>
  );
}

const EMPTY = {
  city: "", name: "", vehicleType: "14ft", tier: "general", startingPoint: "", dailyPrice: "", pricingNote: "",
  supervisorName: "", supervisorContact: "", driverName: "", driverContact: "", packerNames: "",
  vehicleNo: "", vehicleName: "", systemTeamNo: "", remarks: "", isIntercityVendor: false,
};

function AddForm({ onAdded }: { onAdded: (v: VendorMaster) => void }) {
  const [f, setF] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: string, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  async function submit() {
    if (!f.city || !f.name) { setErr("City and vendor name are required"); return; }
    setSaving(true); setErr("");
    const res = await fetch("/api/vendors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
    setSaving(false);
    if (!res.ok) { setErr("Could not save"); return; }
    const { vendor } = await res.json();
    onAdded(vendor);
  }

  const input = "w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm";
  // plain function (NOT a component) so inputs don't remount/lose focus on each keystroke
  const field = (label: string, k: string, type = "text", placeholder = "") => (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-slate-500">{label}</span>
      <input className={input} type={type} placeholder={placeholder} value={(f as unknown as Record<string, string>)[k]} onChange={(e) => set(k, e.target.value)} />
    </label>
  );

  return (
    <Card className="mb-4 p-4">
      <div className="mb-3 text-sm font-semibold text-slate-700">Add a new vendor</div>

      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Vendor &amp; pricing</div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {field("City", "city", "text", "e.g. Bangalore")}
        {field("Vendor name", "name", "text", "e.g. VMS Packers Team 1")}
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-slate-500">Vehicle</span>
          <select className={input} value={f.vehicleType} onChange={(e) => { const vt = e.target.value; setF((p) => ({ ...p, vehicleType: vt, tier: vt === "others" ? "non_general" : p.tier })); }}>
            <option value="14ft">14ft (7 pallets)</option>
            <option value="10ft">10ft (4 pallets)</option>
            <option value="others">Other (7 pallets)</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-slate-500">Tier</span>
          <select className={input} value={f.tier} onChange={(e) => set("tier", e.target.value)}>
            <option value="general">General (pay daily regardless)</option>
            <option value="non_general">Non-general (premium / on-demand)</option>
          </select>
        </label>
        {field("Starting point (locality)", "startingPoint", "text", "e.g. Akshaya Nagar")}
        {field("Daily price (₹)", "dailyPrice", "number", "e.g. 7500")}
        {field("Pricing note (for non-general)", "pricingNote", "text", "e.g. 6 transactions / ₹20,000")}
      </div>

      <div className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Team &amp; vehicle</div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {field("Supervisor name", "supervisorName")}
        {field("Supervisor contact", "supervisorContact")}
        {field("Driver name", "driverName")}
        {field("Driver contact", "driverContact")}
        {field("Packers", "packerNames", "text", "comma-separated")}
        {field("Vehicle no", "vehicleNo", "text", "e.g. KA51AJ4776")}
        {field("Vehicle name", "vehicleName")}
        {field("System team", "systemTeamNo")}
        {field("Remarks", "remarks")}
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={f.isIntercityVendor} onChange={(e) => set("isIntercityVendor", e.target.checked)} /> Intercity vendor
      </label>

      {err && <div className="mt-2 text-xs text-red-600">{err}</div>}
      <button onClick={submit} disabled={saving} className="mt-3 rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">{saving ? "Saving…" : "Save vendor"}</button>
    </Card>
  );
}
