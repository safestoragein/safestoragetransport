import { REGION } from "./config";

export function money(n: number): string {
  const rounded = Math.round(n);
  return `${REGION.currencySymbol}${rounded.toLocaleString("en-IN")}`;
}

export function km(n: number): string {
  return `${n.toLocaleString("en-IN", { maximumFractionDigits: 1 })} ${REGION.distanceUnit}`;
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

// Parse a loose boolean flag from the booking feed. Critical: the API sends "0"/"1"
// as STRINGS, and Boolean("0") === true in JS — so a plain Boolean() wrongly flags
// is_intercity="0" as intercity. Only 1 / "1" / true / "true" count as true.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function flag(v: any): boolean {
  if (v === true || v === 1) return true;
  if (typeof v === "string") { const s = v.trim().toLowerCase(); return s === "1" || s === "true"; }
  return false;
}
