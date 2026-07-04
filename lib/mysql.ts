// MySQL backend for the Transport module.
//
// The app was written against the Supabase JS client (`db().from(t).select()...`).
// Rather than rewrite every call site, this file provides a small MySQL-backed
// query builder that mimics the exact subset of that API the codebase uses:
//   .from() .select() .insert() .update() .upsert() .delete()
//   .eq() .neq() .gt() .gte() .lt() .lte() .in() .is() .ilike()
//   .order() .limit() .single() .maybeSingle()
// Every builder is awaitable and resolves to Supabase's `{ data, error }` shape.
//
// Config via env: either MYSQL_URL (mysql://user:pass@host:port/db[?ssl=true])
// or MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE.

import mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";

/* eslint-disable @typescript-eslint/no-explicit-any */

const {
  MYSQL_URL,
  MYSQL_HOST,
  MYSQL_PORT,
  MYSQL_USER,
  MYSQL_PASSWORD,
  MYSQL_DATABASE,
  MYSQL_SSL,
  MYSQL_POOL_SIZE,
} = process.env;

export const mysqlConfigured = Boolean(MYSQL_URL || (MYSQL_HOST && MYSQL_USER && MYSQL_DATABASE));

// All transport tables share this prefix so they never collide with the other
// systems living in the same (shared) database. Override with MYSQL_TABLE_PREFIX
// if needed — but it must match the prefix used in mysql/schema.sql.
export const TABLE_PREFIX = process.env.MYSQL_TABLE_PREFIX ?? "sst_";

// Tables whose primary key is a Supabase-style UUID `id`. For these, the builder
// generates the id on insert (matching gen_random_uuid()) so `.select()` after an
// insert can return the row without relying on AUTO_INCREMENT.
const UUID_TABLES = new Set([
  "vendors",
  "vendor_documents",
  "transport_users",
  "orders",
  "schedule_runs",
  "schedule_assignments",
  "schedule_changes",
  "notifications",
  "order_events",
]);

let _pool: mysql.Pool | null = null;

function baseOptions(): mysql.PoolOptions {
  return {
    waitForConnections: true,
    connectionLimit: Number(MYSQL_POOL_SIZE) || 10,
    // Return DATE/DATETIME/TIMESTAMP as strings (Supabase returned ISO strings);
    // the app treats dates as strings (map keys, display), never as Date objects.
    dateStrings: true,
    // Postgres booleans came back as true/false. MySQL TINYINT(1) would otherwise
    // arrive as 0/1 numbers and break checks like `active !== false`.
    typeCast(field: any, next: () => any) {
      if (field.type === "TINY" && field.length === 1) {
        const v = field.string();
        return v === null ? null : v === "1";
      }
      return next();
    },
  };
}

function optionsFromUrl(url: string): mysql.PoolOptions {
  const u = new URL(url);
  const wantSsl = MYSQL_SSL === "true" || u.searchParams.get("ssl") === "true" || !!u.searchParams.get("sslmode");
  return {
    host: decodeURIComponent(u.hostname),
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
    ssl: wantSsl ? { rejectUnauthorized: MYSQL_SSL !== "insecure" } : undefined,
    ...baseOptions(),
  };
}

export function pool(): mysql.Pool {
  if (!mysqlConfigured) {
    throw new Error("MySQL is not configured (set MYSQL_URL or MYSQL_HOST/MYSQL_USER/MYSQL_DATABASE).");
  }
  if (!_pool) {
    _pool = MYSQL_URL
      ? mysql.createPool(optionsFromUrl(MYSQL_URL))
      : mysql.createPool({
          host: MYSQL_HOST,
          port: MYSQL_PORT ? Number(MYSQL_PORT) : 3306,
          user: MYSQL_USER,
          password: MYSQL_PASSWORD,
          database: MYSQL_DATABASE,
          ssl: MYSQL_SSL === "true" ? { rejectUnauthorized: true } : MYSQL_SSL === "insecure" ? { rejectUnauthorized: false } : undefined,
          ...baseOptions(),
        });
    // Default InnoDB isolation is REPEATABLE READ, under which a long-lived pooled
    // connection can keep serving a stale snapshot (it won't see rows committed by
    // other connections after its read-view was taken). Force READ COMMITTED on every
    // new connection so each query always sees the latest committed data.
    _pool.on("connection", (conn) => {
      conn.query("SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED");
    });
  }
  return _pool;
}

const idq = (name: string) => mysql.escapeId(name);

// Serialize a JS value for a parameter slot. Objects/arrays -> JSON strings (for
// JSON columns like vendors.supervisors and schedule_changes.payload).
function enc(v: any): any {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v;
  if (Buffer.isBuffer(v)) return v;
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}

interface QueryResult<T = any> {
  data: T;
  error: { message: string; code?: string } | null;
}

type Filter = { sql: string; params: any[] };

class QueryBuilder<T = any> implements PromiseLike<QueryResult<T>> {
  private op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private columns = "*";
  private rows: Record<string, any>[] = [];
  private setData: Record<string, any> | null = null;
  private conflict: string[] = [];
  private filters: Filter[] = [];
  private orders: string[] = [];
  private _limit: number | null = null;
  private returning = false;
  private singleMode: "none" | "single" | "maybe" = "none";

  constructor(private table: string) {}

  // Physical table name (prefixed). `table` stays the logical name for UUID_TABLES lookups.
  private get phys(): string { return TABLE_PREFIX + this.table; }

  // ── selection / mutations ────────────────────────────────────────────────
  select(cols = "*"): this {
    if (this.op === "select") this.columns = cols || "*";
    else this.returning = true; // `.insert(...).select()` / `.update(...).select()`
    return this;
  }
  insert(rows: Record<string, any> | Record<string, any>[]): this {
    this.op = "insert";
    this.rows = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  upsert(rows: Record<string, any> | Record<string, any>[], opts?: { onConflict?: string }): this {
    this.op = "upsert";
    this.rows = Array.isArray(rows) ? rows : [rows];
    this.conflict = opts?.onConflict ? opts.onConflict.split(",").map((s) => s.trim()).filter(Boolean) : [];
    return this;
  }
  update(row: Record<string, any>): this {
    this.op = "update";
    this.setData = row;
    return this;
  }
  delete(): this {
    this.op = "delete";
    return this;
  }

  // ── filters ──────────────────────────────────────────────────────────────
  eq(col: string, val: any): this { this.filters.push({ sql: `${idq(col)} = ?`, params: [val] }); return this; }
  neq(col: string, val: any): this { this.filters.push({ sql: `${idq(col)} <> ?`, params: [val] }); return this; }
  gt(col: string, val: any): this { this.filters.push({ sql: `${idq(col)} > ?`, params: [val] }); return this; }
  gte(col: string, val: any): this { this.filters.push({ sql: `${idq(col)} >= ?`, params: [val] }); return this; }
  lt(col: string, val: any): this { this.filters.push({ sql: `${idq(col)} < ?`, params: [val] }); return this; }
  lte(col: string, val: any): this { this.filters.push({ sql: `${idq(col)} <= ?`, params: [val] }); return this; }
  is(col: string, val: any): this {
    if (val === null) this.filters.push({ sql: `${idq(col)} IS NULL`, params: [] });
    else this.filters.push({ sql: `${idq(col)} = ?`, params: [val] });
    return this;
  }
  in(col: string, arr: any[]): this {
    if (!arr || arr.length === 0) this.filters.push({ sql: "1 = 0", params: [] });
    else this.filters.push({ sql: `${idq(col)} IN (${arr.map(() => "?").join(", ")})`, params: [...arr] });
    return this;
  }
  ilike(col: string, pattern: any): this {
    this.filters.push({ sql: `LOWER(${idq(col)}) LIKE LOWER(?)`, params: [pattern] });
    return this;
  }

  // ── ordering / limiting / single ─────────────────────────────────────────
  order(col: string, opts?: { ascending?: boolean }): this {
    this.orders.push(`${idq(col)} ${opts?.ascending === false ? "DESC" : "ASC"}`);
    return this;
  }
  limit(n: number): this { this._limit = n; return this; }
  single(): this { this.singleMode = "single"; return this; }
  maybeSingle(): this { this.singleMode = "maybe"; return this; }

  // ── execution (thenable) ─────────────────────────────────────────────────
  then<R1 = QueryResult<T>, R2 = never>(
    onfulfilled?: ((value: QueryResult<T>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: any) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.exec().then(onfulfilled, onrejected);
  }

  private where(): Filter {
    if (!this.filters.length) return { sql: "", params: [] };
    return {
      sql: " WHERE " + this.filters.map((f) => f.sql).join(" AND "),
      params: this.filters.flatMap((f) => f.params),
    };
  }

  private projection(): string {
    if (this.columns === "*") return "*";
    return this.columns.split(",").map((c) => idq(c.trim())).join(", ");
  }

  private withId(row: Record<string, any>): Record<string, any> {
    if (UUID_TABLES.has(this.table) && (row.id === undefined || row.id === null || row.id === "")) {
      return { id: randomUUID(), ...row };
    }
    return row;
  }

  private shape(rows: Record<string, any>[]): QueryResult<any> {
    if (this.singleMode === "single") {
      if (rows.length === 1) return { data: rows[0], error: null };
      if (rows.length === 0) return { data: null, error: { message: "no rows returned", code: "PGRST116" } };
      return { data: null, error: { message: "multiple rows returned" } };
    }
    if (this.singleMode === "maybe") {
      return { data: rows[0] ?? null, error: null };
    }
    return { data: rows, error: null };
  }

  private async exec(): Promise<QueryResult<any>> {
    try {
      const p = pool();

      if (this.op === "select") {
        const w = this.where();
        let sql = `SELECT ${this.projection()} FROM ${idq(this.phys)}${w.sql}`;
        if (this.orders.length) sql += " ORDER BY " + this.orders.join(", ");
        if (this._limit != null) sql += ` LIMIT ${Number(this._limit)}`;
        else if (this.singleMode !== "none") sql += " LIMIT 2"; // let shape() detect >1
        const [rows] = await p.query(sql, w.params);
        return this.shape(rows as Record<string, any>[]);
      }

      if (this.op === "insert" || this.op === "upsert") {
        const rows = this.rows.map((r) => this.withId(r));
        if (!rows.length) return { data: null, error: null };
        const cols = Object.keys(rows[0]);
        const placeholders = rows.map(() => `(${cols.map(() => "?").join(", ")})`).join(", ");
        const params = rows.flatMap((r) => cols.map((c) => enc(r[c])));
        let sql = `INSERT INTO ${idq(this.phys)} (${cols.map(idq).join(", ")}) VALUES ${placeholders}`;
        if (this.op === "upsert") {
          // Update every column except the conflict keys and the generated id.
          const skip = new Set([...this.conflict, "id"]);
          const upd = cols.filter((c) => !skip.has(c));
          const setSql = (upd.length ? upd : cols).map((c) => `${idq(c)} = VALUES(${idq(c)})`).join(", ");
          sql += ` ON DUPLICATE KEY UPDATE ${setSql}`;
        }
        await p.query(sql, params);

        if (this.returning) {
          const ids = rows.map((r) => r.id).filter((v) => v != null);
          if (UUID_TABLES.has(this.table) && ids.length) {
            const [back] = await p.query(
              `SELECT * FROM ${idq(this.phys)} WHERE ${idq("id")} IN (${ids.map(() => "?").join(", ")})`,
              ids,
            );
            return this.shape(back as Record<string, any>[]);
          }
          return this.shape(rows); // fallback: echo what we inserted
        }
        return { data: null, error: null };
      }

      if (this.op === "update") {
        const set = this.setData || {};
        const cols = Object.keys(set);
        if (!cols.length) return { data: null, error: null };
        const w = this.where();
        const sql = `UPDATE ${idq(this.phys)} SET ${cols.map((c) => `${idq(c)} = ?`).join(", ")}${w.sql}`;
        await p.query(sql, [...cols.map((c) => enc(set[c])), ...w.params]);
        if (this.returning) {
          const [rows] = await p.query(`SELECT * FROM ${idq(this.phys)}${w.sql}`, w.params);
          return this.shape(rows as Record<string, any>[]);
        }
        return { data: null, error: null };
      }

      if (this.op === "delete") {
        const w = this.where();
        await p.query(`DELETE FROM ${idq(this.phys)}${w.sql}`, w.params);
        return { data: null, error: null };
      }

      return { data: null, error: { message: `unsupported op ${this.op}` } };
    } catch (e: any) {
      return { data: null, error: { message: e?.sqlMessage || e?.message || String(e), code: e?.code } };
    }
  }
}

export interface MysqlClient {
  from: <T = any>(table: string) => QueryBuilder<T>;
}

export function mysqlClient(): MysqlClient {
  return { from: <T = any>(table: string) => new QueryBuilder<T>(table) };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
