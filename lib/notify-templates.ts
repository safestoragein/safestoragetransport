// Builds the WhatsApp template payloads for customer/vendor notifications.
// Template names are fixed (register these exact names in Interakt). All message content
// comes from the booking data — the only config needed is INTERAKT_API_KEY.
// The bodyValues order below is the {{1}}, {{2}}, … order your Interakt templates must use.

export const TEMPLATES = {
  customerSlot: "ss_customer_slot",           // customer asked for a specific time
  customerShortly: "ss_customer_shortly",     // no specific time
  vendorFixed: "ss_vendor_fixed",             // at least one stop has a fixed customer time
  vendorRecommended: "ss_vendor_recommended", // no fixed times → our recommended order
};

const fmtMin = (min: number) => {
  const h = Math.floor(min / 60) % 24, m = Math.round(min % 60);
  const ap = h >= 12 ? "PM" : "AM"; let hh = h % 12; if (hh === 0) hh = 12;
  return m ? `${hh}:${String(m).padStart(2, "0")} ${ap}` : `${hh} ${ap}`;
};

export function typeWord(orderType?: string | null): string {
  return /retriev/.test(String(orderType || "").toLowerCase()) ? "retrieval" : "pickup";
}

export function fmtDate(d?: string | null): string {
  if (!d) return "the scheduled day";
  const dt = new Date(String(d).slice(0, 10) + "T00:00:00");
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

// Explicit customer time request (parsed from the booking notes) → a 1-hour window. null otherwise.
export function requestedWindow(requiredTime?: string | null): string | null {
  const src = (requiredTime && requiredTime.trim()) || "";
  if (!src) return null;
  const m = src.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return src; // e.g. "morning slot" → pass through
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const ap = (m[3] || "").toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  const start = h * 60 + min;
  return `${fmtMin(start)}–${fmtMin(start + 60)}`;
}

export interface OrderLike {
  order_type?: string | null; customer_name?: string | null; contact?: string | null;
  locality?: string | null; time_slot?: string | null; required_time?: string | null; schedule_date?: string | null;
}

// ── Customer: NEVER contains vendor details ──────────────────────────────────
export function customerMessage(o: OrderLike, date?: string | null) {
  const win = requestedWindow(o.required_time);
  const kind = typeWord(o.order_type);
  const dateStr = fmtDate(date ?? o.schedule_date);
  const name = o.customer_name || "Customer";
  if (win) return { template: TEMPLATES.customerSlot, bodyValues: [name, kind, dateStr, win] };
  return { template: TEMPLATES.customerShortly, bodyValues: [name, kind, dateStr] };
}

// ── Vendor: ONE clubbed message with all stops (customer contact + timing, no pallets) ──
// `orders` must be pre-sorted into the recommended sequence (by trip/stop).
export function vendorMessage(vendorName: string, orders: OrderLike[], date?: string | null) {
  let anyFixed = false;
  const lines = orders.map((o, i) => {
    const win = requestedWindow(o.required_time);
    let timing: string;
    if (win) { anyFixed = true; timing = `${win} (fixed)`; }
    else if (o.time_slot) timing = `slot ${o.time_slot}`;
    else timing = "flexible";
    const kind = typeWord(o.order_type);
    return `${i + 1}. ${o.customer_name || "Customer"}, ${o.contact || "-"} — ${o.locality || "-"} — ${kind} — ${timing}`;
  });
  const list = lines.join("\n");
  const template = anyFixed ? TEMPLATES.vendorFixed : TEMPLATES.vendorRecommended;
  return { template, bodyValues: [vendorName || "Partner", fmtDate(date), list] };
}
