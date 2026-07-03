// Builds the WhatsApp template payloads for customer/vendor notifications.
// Template NAMES are configurable via env so they can match whatever you register in Interakt.
// The order of bodyValues below is the {{1}}, {{2}}, … order your Interakt template must use.

export const TEMPLATES = {
  // Customer, a specific time was requested → give a 1-hour arrival window.
  customerSlot: process.env.INTERAKT_TPL_CUSTOMER_SLOT || "ss_customer_slot",
  // Customer, no specific time → "partner will be in touch shortly".
  customerShortly: process.env.INTERAKT_TPL_CUSTOMER_SHORTLY || "ss_customer_shortly",
  // Vendor, one message per assigned order (includes the customer's contact + timing).
  vendorOrder: process.env.INTERAKT_TPL_VENDOR_ORDER || "ss_vendor_order",
};

const fmtMin = (min: number) => {
  const h = Math.floor(min / 60) % 24, m = Math.round(min % 60);
  const ap = h >= 12 ? "PM" : "AM"; let hh = h % 12; if (hh === 0) hh = 12;
  return m ? `${hh}:${String(m).padStart(2, "0")} ${ap}` : `${hh} ${ap}`;
};

// "pickup" | "full_retrieval" | "partial_retrieval" → words for each audience.
export function typeWord(orderType?: string | null, audience: "customer" | "vendor" = "customer"): string {
  const t = String(orderType || "").toLowerCase();
  if (/retriev/.test(t)) return audience === "customer" ? "delivery" : "retrieval";
  return "pickup";
}

// Friendly date, e.g. "Sat, 5 Jul 2026".
export function fmtDate(d?: string | null): string {
  if (!d) return "the scheduled day";
  const dt = new Date(String(d).slice(0, 10) + "T00:00:00");
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

// A customer explicitly asked for a time → derive a 1-hour window ("9–10 AM").
// Returns null when there's no explicit request (drives the "in touch shortly" template).
export function requestedWindow(requiredTime?: string | null, timeSlot?: string | null): string | null {
  const src = (requiredTime && requiredTime.trim()) || "";
  if (!src) return null; // only an EXPLICIT customer request (from notes) counts as "specific"
  const m = src.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return src; // e.g. "morning slot" — pass the text through
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const ap = (m[3] || "").toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  // No am/pm and hour <= 7 → assume PM for typical evening asks; otherwise keep as-is (best effort).
  const start = h * 60 + min;
  return `${fmtMin(start)}–${fmtMin(start + 60)}`;
  void timeSlot;
}

export interface OrderLike {
  order_type?: string | null; customer_name?: string | null; contact?: string | null;
  locality?: string | null; pallets?: number | string | null; stated_pallets?: number | string | null;
  time_slot?: string | null; required_time?: string | null; schedule_date?: string | null;
}

// ── Customer message: NEVER contains vendor details ──────────────────────────
export function customerMessage(o: OrderLike, date?: string | null) {
  const win = requestedWindow(o.required_time, o.time_slot);
  const kind = typeWord(o.order_type, "customer");
  const dateStr = fmtDate(date ?? o.schedule_date);
  const name = o.customer_name || "Customer";
  if (win) {
    return { template: TEMPLATES.customerSlot, bodyValues: [name, kind, dateStr, win] };
  }
  return { template: TEMPLATES.customerShortly, bodyValues: [name, kind, dateStr] };
}

// ── Vendor message (per order): includes the customer's contact + firm timing ─
export function vendorOrderMessage(vendorName: string, o: OrderLike, date?: string | null) {
  const win = requestedWindow(o.required_time, o.time_slot);
  const kind = typeWord(o.order_type, "vendor");
  const dateStr = fmtDate(date ?? o.schedule_date);
  const pallets = o.stated_pallets ?? o.pallets ?? "-";
  const timing = win ? `${win} — please reach in this slot` : "flexible (as per your day plan)";
  return {
    template: TEMPLATES.vendorOrder,
    bodyValues: [vendorName || "Partner", kind, dateStr, o.customer_name || "Customer", o.contact || "-", o.locality || "-", pallets, timing],
  };
}
