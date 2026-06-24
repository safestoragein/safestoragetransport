// Parse the messy real time-slot strings into minutes-from-midnight ranges.
// Handles: "10:00 AM - 11:00 AM", "9am_11am", "10am_12pm", "9am_10am", "1:00 PM - 2:00 PM",
// "11:00:00", "Confirm 6 AM- 3 PM", "" / null.

export interface Slot {
  startMin: number;
  endMin: number;
}

interface Tok {
  h: number;
  m: number;
  ap?: "am" | "pm";
}

export function parseSlot(raw?: string | null): Slot | null {
  if (!raw) return null;
  const str = String(raw).toLowerCase();
  const re = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/g;
  const toks: Tok[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(str)) && toks.length < 2) {
    const h = +m[1];
    if (h < 1 || h > 23) continue;
    toks.push({ h, m: m[2] ? +m[2] : 0, ap: (m[3] as "am" | "pm") || undefined });
  }
  if (toks.length === 0) return null;

  // infer missing am/pm from the sibling token, else from a daytime heuristic
  const known = toks.find((t) => t.ap)?.ap;
  const toMin = (t: Tok): number => {
    let ap = t.ap ?? known;
    if (!ap) ap = t.h >= 8 && t.h <= 11 ? "am" : "pm"; // 9-11 -> am; 12-7 -> pm
    let h = t.h % 12;
    if (ap === "pm") h += 12;
    return h * 60 + t.m;
  };

  const start = toMin(toks[0]);
  let end = toks[1] ? toMin(toks[1]) : start + 60;
  if (end <= start) end = start + 60;
  return { startMin: start, endMin: end };
}

// Pull a customer-requested time out of free-text team notes (customer_notes).
// Returns a short label + a parsed window when confident, so we can schedule in that slot only.
export function parseRequiredTime(notes?: string | null): { text: string; slot?: Slot } | null {
  if (!notes) return null;
  const n = notes.toLowerCase();
  if (!/\b(slot|morning|afternoon|evening|noon|\d{1,2}\s*(am|pm)|\d{1,2}:\d{2})\b/.test(n)) return null;

  let slot: Slot | undefined;
  let text = "";

  // explicit clock time wins: "10am", "at 11:30 am", "before 2pm", "after 3 pm"
  const m = n.match(/(before|after|by|around|at)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  if (m) {
    const ps = parseSlot(m[2] + (m[3] ? ":" + m[3] : "") + " " + m[4]);
    if (ps) {
      const word = m[1];
      if (word === "before" || word === "by") slot = { startMin: 9 * 60, endMin: ps.startMin };
      else if (word === "after") slot = { startMin: ps.startMin, endMin: Math.min(20 * 60, ps.startMin + 180) };
      else slot = ps;
      text = m[0].trim();
    }
  }
  if (!slot && /morning/.test(n)) { slot = { startMin: 9 * 60, endMin: 12 * 60 }; text = "morning slot"; }
  else if (!slot && /(afternoon|noon)/.test(n)) { slot = { startMin: 12 * 60, endMin: 15 * 60 }; text = "afternoon slot"; }
  else if (!slot && /evening/.test(n)) { slot = { startMin: 16 * 60, endMin: 19 * 60 }; text = "evening slot"; }

  if (!slot && !text) text = "time request";
  return { text: text || "time request", slot };
}

export function fmtMin(min: number): string {
  const h24 = Math.floor(min / 60);
  const m = min % 60;
  const ap = h24 >= 12 ? "PM" : "AM";
  const h = ((h24 + 11) % 12) + 1;
  return m === 0 ? `${h} ${ap}` : `${h}:${String(m).padStart(2, "0")} ${ap}`;
}
