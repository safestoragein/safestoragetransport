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
