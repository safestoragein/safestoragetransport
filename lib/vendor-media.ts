// Vendor app extras: (1) view-only inventory for a job (proxied to the WMS), (2) KYC + pickup/
// delivery proof photos stored in the transport DB.
import { db, hasDb } from "./db";

const API_BASE = process.env.SAFESTORAGE_API_BASE || "https://safestorage.in/back";

/* eslint-disable @typescript-eslint/no-explicit-any */

// The order must belong to this vendor in some run (same guard used for status updates).
export async function vendorOwnsOrder(vendorId: string, orderUuid: string): Promise<boolean> {
  if (!hasDb) return false;
  const { data } = await db().from("schedule_assignments").select("id").eq("order_id", orderUuid).eq("vendor_id", vendorId).limit(1);
  return !!data?.length;
}

const arrOf = (r: any): any[] => (Array.isArray(r) ? r : r?.data || []);
const postForm = (path: string, data: Record<string, string>) =>
  fetch(`${API_BASE}/${path}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(data).toString() }).then((r) => r.json());

// Read-only item list for a job. PICKUPS use the quotation inventory; RETRIEVALS use the goods list
// (full → by customer, partial → by order). Resolves WMS ids from the live feed. [] on any miss.
export async function orderInventory(orderUuid: string): Promise<{ items: any[] }> {
  if (!hasDb) return { items: [] };
  try {
    const { data: rows } = await db().from("orders").select("order_id, order_type").eq("id", orderUuid).limit(1);
    const sysOrderId = rows?.[0]?.order_id;
    if (!sysOrderId) return { items: [] };
    const feed: any = await fetch(`${API_BASE}/transport_controller_Dev0/get_work_order_list_api_new`, { next: { revalidate: 60 } }).then((r) => r.json());
    const entry = arrOf(feed).find((x) => String(x.order_id) === String(sysOrderId));
    if (!entry) return { items: [] };
    const type = String(entry.order_type || rows?.[0]?.order_type || "");
    let raw: any[] = [];
    if (/retriev/i.test(type)) {
      // Retrievals: goods list (goods_name / goods_quantity)
      raw = /partial/i.test(type)
        ? arrOf(await postForm("transport_controller_Dev0/get_pickup_order_list_of_partial_retrieval", { order_id: String(sysOrderId) }))
        : arrOf(await postForm("transport_controller_Dev0/get_full_retrieval_order_list_of_items", { customer_id: String(entry.customer_id ?? "") }));
      return { items: raw.map((it) => ({ name: it.goods_name ?? it.storage_item_name ?? "Item", qty: Number(it.goods_quantity ?? it.quantity ?? 0) || null })) };
    }
    // Pickups: quotation inventory (storage_item_name / storage_item_qty)
    if (!entry.quotation_id) return { items: [] };
    const q = new URLSearchParams({ customer_id: String(entry.customer_id ?? ""), quotation_id: String(entry.quotation_id) });
    if (entry.supervisor_id) q.set("supervisor_id", String(entry.supervisor_id));
    raw = arrOf(await fetch(`${API_BASE}/app/get_inventory_quotation_for_app?${q.toString()}`).then((r) => r.json()));
    // Quantity comes as `item_count` on the quotation endpoint (e.g. 5 × SafeStorage box).
    return { items: raw.map((it) => ({ name: it.storage_item_name ?? it.item_name ?? "Item", qty: Number(it.item_count ?? it.storage_item_qty ?? it.quantity ?? 0) || null, slug: it.storage_item_slug ?? null })) };
  } catch {
    return { items: [] };
  }
}

export async function saveOrderPhoto(opts: {
  orderUuid: string; vendorId: string; kind: string; data: Buffer; filename?: string; contentType?: string;
}): Promise<void> {
  if (!hasDb) return;
  await db().from("order_photos").insert({
    order_id: opts.orderUuid, vendor_id: opts.vendorId, kind: opts.kind,
    filename: opts.filename ?? null, content_type: opts.contentType ?? null, byte_size: opts.data.length, data: opts.data,
  });
}

// Metadata (no blobs) of the photos on an order — the app uses this to know KYC is done.
export async function listOrderPhotos(orderUuid: string): Promise<{ id: string; kind: string; createdAt: string }[]> {
  if (!hasDb) return [];
  const { data } = await db().from("order_photos").select("id, kind, created_at").eq("order_id", orderUuid).order("created_at", { ascending: false });
  return (data ?? []).map((p: any) => ({ id: p.id, kind: p.kind, createdAt: p.created_at }));
}

export async function getOrderPhoto(id: string): Promise<{ data: Buffer; contentType: string } | null> {
  if (!hasDb) return null;
  const { data } = await db().from("order_photos").select("data, content_type").eq("id", id).limit(1);
  const row: any = data?.[0];
  if (!row) return null;
  const buf = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data);
  return { data: buf, contentType: row.content_type || "image/jpeg" };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
