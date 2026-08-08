// Editable settings, stored in safestorage.settings (key/value). Falls back to the static
// REGION defaults when the database isn't configured so the app still works offline.
import { db, hasDb } from "./db";
import { REGION, PACKAGE_PER_PALLET } from "./config";

export const PACKING_KEY = "packing_per_pallet";

export async function getPackingPerPallet(): Promise<number> {
  if (!hasDb) return REGION.packingPerPallet;
  try {
    const { data } = await db().from("settings").select("value").eq("key", PACKING_KEY).maybeSingle();
    const v = Number(data?.value);
    return Number.isFinite(v) && v >= 0 ? v : REGION.packingPerPallet;
  } catch {
    return REGION.packingPerPallet;
  }
}

export async function setPackingPerPallet(value: number): Promise<void> {
  // updated_at is maintained by the column's ON UPDATE CURRENT_TIMESTAMP.
  const { error } = await db().from("settings").upsert({ key: PACKING_KEY, value }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

// The P&L's package charge per pallet. Deliberately SEPARATE from packing_per_pallet above: that
// one is the scheduler's costing figure, this one is what the team bills in the Weekly/Monthly
// report. They were set to different values (2,000 vs 1,400), so one key can't serve both.
export const PACKAGE_KEY = "package_per_pallet";

export async function getPackagePerPallet(): Promise<number> {
  if (!hasDb) return PACKAGE_PER_PALLET;
  try {
    const { data } = await db().from("settings").select("value").eq("key", PACKAGE_KEY).maybeSingle();
    const v = Number(data?.value);
    return Number.isFinite(v) && v >= 0 ? v : PACKAGE_PER_PALLET;
  } catch {
    return PACKAGE_PER_PALLET;
  }
}

export async function setPackagePerPallet(value: number): Promise<void> {
  const { error } = await db().from("settings").upsert({ key: PACKAGE_KEY, value }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}
