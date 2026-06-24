import { VendorTier } from "@/lib/types";

// Distinct colours per vendor for the map + legend. Cycles if more vendors than colours.
const VENDOR_COLORS = [
  "#2563eb", "#059669", "#d97706", "#7c3aed", "#dc2626",
  "#0891b2", "#db2777", "#65a30d", "#ea580c", "#4f46e5",
];

export function vendorColor(index: number): string {
  return VENDOR_COLORS[index % VENDOR_COLORS.length];
}

export const TIER_STYLE: Record<VendorTier, { label: string; chip: string; dot: string }> = {
  general: { label: "Type A · general", chip: "bg-blue-50 text-blue-700 ring-blue-200", dot: "bg-blue-500" },
  non_general: { label: "Type B · non-general", chip: "bg-amber-50 text-amber-700 ring-amber-200", dot: "bg-amber-500" },
};

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>
  );
}

export function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}
