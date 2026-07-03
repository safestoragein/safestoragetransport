import { describe, it, expect, vi, beforeEach } from "vitest";

/* eslint-disable @typescript-eslint/no-explicit-any */
const { captured } = vi.hoisted(() => ({ captured: [] as any[] }));

vi.mock("mysql2/promise", () => ({
  default: {
    escapeId: (s: string) => "`" + s + "`",
    createPool: () => ({
      query: async (sql: string, params: any[]) => {
        captured.push({ sql, params });
        if (/^SELECT/i.test(sql)) return [[{ id: "ROW-UUID", order_id: "O1", value: "2000.0" }], []];
        return [{ affectedRows: 1 }, []];
      },
      on: () => {},
    }),
  },
}));

process.env.MYSQL_HOST = "localhost";
process.env.MYSQL_USER = "u";
process.env.MYSQL_DATABASE = "db";

const { mysqlClient } = await import("../lib/mysql");
const c = mysqlClient();
const last = () => captured[captured.length - 1];
const at = (i: number) => captured[captured.length - i];

beforeEach(() => { captured.length = 0; });

describe("select", () => {
  it("prefixes the table, projects columns, builds WHERE/ORDER/LIMIT", async () => {
    await c.from("vendors").select("id, name").eq("active", true).ilike("city", "blr").order("name", { ascending: false }).limit(5);
    expect(last().sql).toBe("SELECT `id`, `name` FROM `sst_vendors` WHERE `active` = ? AND LOWER(`city`) LIKE LOWER(?) ORDER BY `name` DESC LIMIT 5");
    expect(last().params).toEqual([true, "blr"]);
  });
  it("empty in() becomes 1 = 0 (no rows), never invalid SQL", async () => {
    await c.from("orders").select("*").in("id", []);
    expect(last().sql).toContain("WHERE 1 = 0");
  });
  it("in() with values expands placeholders", async () => {
    await c.from("orders").select("id").in("order_id", ["A", "B"]);
    expect(last().sql).toBe("SELECT `id` FROM `sst_orders` WHERE `order_id` IN (?, ?)");
    expect(last().params).toEqual(["A", "B"]);
  });
});

describe("insert / upsert", () => {
  it("generates a UUID id for uuid tables and re-selects on .select()", async () => {
    const r = await c.from("schedule_runs").insert({ city: "blr", trigger: "manual" }).select().single();
    const ins = at(2), sel = at(1);
    expect(ins.sql).toMatch(/^INSERT INTO `sst_schedule_runs` \(`id`, `city`, `trigger`\) VALUES \(\?, \?, \?\)$/);
    expect(ins.params[0]).toMatch(/^[0-9a-f-]{36}$/); // app-generated uuid
    expect(sel.sql).toContain("SELECT * FROM `sst_schedule_runs` WHERE `id` IN (?)");
    expect(r.data.id).toBe("ROW-UUID");
  });
  it("upsert excludes the conflict keys and id from the UPDATE clause", async () => {
    await c.from("orders").upsert([{ order_id: "O1", city: "blr", pallets: 5 }], { onConflict: "order_id" });
    const sql = last().sql;
    expect(sql).toContain("ON DUPLICATE KEY UPDATE");
    expect(sql).toContain("`city` = VALUES(`city`)");
    expect(sql).toContain("`pallets` = VALUES(`pallets`)");
    expect(sql).not.toContain("`order_id` = VALUES(`order_id`)"); // conflict key not overwritten
    expect(sql).not.toContain("`id` = VALUES(`id`)");             // generated id preserved
  });
  it("JSON-encodes object/array values (supervisors/payload)", async () => {
    await c.from("vendors").insert({ name: "V", supervisors: [{ name: "A", phone: "1" }] });
    expect(last().params).toContain('[{"name":"A","phone":"1"}]');
  });
  it("passes booleans through (mysql2 maps to 0/1)", async () => {
    await c.from("orders").insert({ order_id: "O1", is_intercity: false });
    expect(last().params).toContain(false);
  });
});

describe("update / delete / maybeSingle", () => {
  it("update sets columns and applies the where", async () => {
    await c.from("schedule_assignments").update({ vendor_id: null }).eq("id", "A1");
    expect(last().sql).toBe("UPDATE `sst_schedule_assignments` SET `vendor_id` = ? WHERE `id` = ?");
    expect(last().params).toEqual([null, "A1"]);
  });
  it("delete builds a DELETE with the where", async () => {
    await c.from("vendors").delete().eq("id", "V1");
    expect(last().sql).toBe("DELETE FROM `sst_vendors` WHERE `id` = ?");
  });
  it("maybeSingle returns the first row (or null), not an array", async () => {
    const r = await c.from("settings").select("value").eq("key", "packing_per_pallet").maybeSingle();
    expect(r.error).toBeNull();
    expect(r.data).toMatchObject({ id: "ROW-UUID" });
  });
});
