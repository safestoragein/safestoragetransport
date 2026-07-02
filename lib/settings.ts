// Editable settings, stored in safestorage.settings (key/value). Falls back to the static
// REGION defaults when the database isn't configured so the app still works offline.
import { db, hasDb } from "./db";
import { REGION } from "./config";

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
