// Shared DB client for the `safestoragetransport` MySQL schema. Exposes a Supabase-style
// `db().from(table)...` query builder (see lib/mysql.ts) so existing call sites
// keep working after the move off Supabase.
import { mysqlClient, mysqlConfigured, MysqlClient } from "./mysql";

export const hasDb = mysqlConfigured;

export function db(): MysqlClient {
  if (!hasDb) throw new Error("MySQL is not configured (set MYSQL_URL or MYSQL_HOST/MYSQL_USER/MYSQL_DATABASE).");
  return mysqlClient();
}

export const isUuid = (s?: string | null) =>
  !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
