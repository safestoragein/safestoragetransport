// Shared Supabase server client (service-role) scoped to the `safestorage` schema.
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const hasDb = Boolean(URL && KEY);

/* eslint-disable @typescript-eslint/no-explicit-any */
let _client: any = null;
export function db(): any {
  if (!hasDb) throw new Error("Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).");
  if (!_client) _client = createClient(URL!, KEY!, { db: { schema: "safestorage" }, auth: { persistSession: false } });
  return _client;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export const isUuid = (s?: string | null) =>
  !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
