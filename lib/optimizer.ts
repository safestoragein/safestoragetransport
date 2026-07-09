// The allocation engine.
//
// Economics (SafeStorage): work is priced in PALLETS, in blocks of 7.
//   Type A (general): obligation 7 pallets/day @ ₹6,500 (paid regardless -> fill first).
//                     extra capacity @ ₹7,000 per 7-pallet block, up to the vendor's max.
//   Type B (non-general): no obligation, ₹8,000 per 7-pallet block. Used only after A is full.
// Distance is NOT a cost lever (A is a fixed daily price however far they drive); routes are
// still built sensibly for the driver, but km never enters the cost.
//
// WATERFALL:
//   Phase 1  Fill every Type A vendor to its 7-pallet obligation (that ₹6,500 is already committed).
//   Phase 2  Distribute the rest to the LEAST marginal block cost — A's extra ₹7,000 block beats
//            B's ₹8,000 block, and filling slack in an already-open block is free — until A is
//            exhausted, then B. Respect each vendor's max pallets/day.
// Trips still pack two customers together when pallets <= vehicle capacity (operational only).

import {
  Assignment,
  Booking,
  GeoPoint,
  ObligationStatus,
  OptimizationResult,
  PlanComparison,
  Trip,
  Vendor,
} from "./types";
import { REGION, effectiveCapacity, TRIPS_PER_DAY, teamsNeeded } from "./config";
import { vendorFamily } from "./split";
import { roadKm, round1 } from "./geo";

const EPS = 0.001;

// Pickups are sized to a vehicle off the stated count (>=5 -> 14ft, else 10ft). Prefer placing
// them on a matching-vehicle GENERAL vendor; non_general/intercity vendors are flexible. This is a
// soft preference (a penalty, not a hard block) so an order still schedules if only one class is free.
const VEHICLE_PENALTY_KM = 1000;
// When a SECOND team is needed, prefer another team of the SAME vendor (team rule: a vendor with 2
// teams sends both). Worth ~this many km of detour so a sibling team wins over a nearer stranger.
const SIBLING_BONUS_KM = 25;
// Priority group (A/B/C) is now a SECONDARY tiebreak, below proximity. It's worth this many km per
// group step: a higher-priority vendor wins only when it's within ~this distance of a nearer lower-
// priority one. Raise it to make priority stronger, lower it to make proximity even more dominant.
const PRIORITY_TIEBREAK_KM = 3;
// Hard cap: never auto-assign more than this many orders (stops) to one vendor in a day. Overflow
// goes to the "team to assign" bucket rather than piling a 4th stop on someone.
const MAX_ORDERS_PER_VENDOR = 3;
const vehicleMismatch = (v: Vendor, b: Booking) =>
  !!b.requiredVehicle && v.tier === "general" && v.vehicle.type !== b.requiredVehicle;

// Customer time window from the booked slot ("9am_11am", "10:00 AM - 11:00 AM").
function slotWindow(b: Booking): { s: number; e: number } | null {
  const sl = b.timeSlot; if (!sl) return null;
  const re = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/g; const ts: number[] = []; let m: RegExpExecArray | null;
  while ((m = re.exec(sl.toLowerCase()))) {
    let h = +m[1]; const mi = m[2] ? +m[2] : 0; const ap = m[3];
    if (ap === "pm" && h !== 12) h += 12; if (ap === "am" && h === 12) h = 0;
    ts.push(h * 60 + mi);
  }
  return ts.length ? { s: ts[0], e: ts[ts.length - 1] || ts[0] } : null;
}
const windowsOverlap = (a: { s: number; e: number } | null, b: { s: number; e: number } | null) => !!a && !!b && a.s < b.e && b.s < a.e;

// ---- Phase-2 scoring, ALL in km-equivalents (lower = better) ----
// Opening another vehicle costs ~₹5-7.5k, which we price as this many km of detour: an order joins an
// already-running vehicle only while that vehicle's cluster is within ~this distance advantage of the
// nearest FREE vendor. Beyond it, the order opens the nearer free vendor instead — so a vendor is
// NEVER dragged across the city (Kasavanahalli → Yelahanka) just to top a truck off.
const NEW_VEHICLE_KM = 15;
// A same-window clash is a gentle nudge among near-equal open vehicles, never a reason for a new one.
const WINDOW_CONFLICT_KM = 8;
// Premium (non-general, per-transaction) vendors are kept for overflow unless they're clearly nearest.
const NON_GENERAL_KM = 40;
// Wrong vehicle size for the order's stated class — soft, so the order still schedules if it must.
const VEHICLE_MISMATCH_KM = 60;
// Pass 1 (priority-A generals) never reaches beyond this — a far-flung order waits for pass 2, where
// a nearer B/non-general vendor may exist, instead of being dragged onto an A vendor across the city.
const A_PASS_MAX_KM = 20;
// With at least this many orders left after the A pass, the bulk non-general (Daksh: 6 transactions /
// 14 pallets / ₹15k) flips from penalised overflow to PREFERRED (worth ~BULK_BONUS km closer) — at
// volume one 6-transaction vendor beats opening 2+ general vehicles. Distance still vetoes: a
// leftover far from Daksh with a general B nearby goes to the B. Below the threshold, a single
// general B vehicle (₹5-7.5k/day) is cheaper and the non-general keeps its penalty.
const NON_GENERAL_BULK_THRESHOLD = 4;
const NON_GENERAL_BULK_BONUS_KM = -12;
// LAST tiebreaks (below A-first and the Daksh volume rule), applied only when OPENING a vehicle —
// once a vehicle is on the road its daily price is sunk, so filling it stays free:
//   - price-aware: every ₹1k/day above the cheapest available vendor costs ~2 km, so a ₹5k 10ft
//     beats a ₹7.5k 14ft (+5 km) for the same order unless the pricier one is clearly nearer;
//   - small-load→small-van: a load that fits a 10ft doesn't OPEN a fresh 14ft general (+6 km nudge).
const PRICE_KM_PER_1K = 2;
const SMALL_ON_14FT_KM = 6;

interface WorkingTrip {
  bookings: Booking[];
  warehouseLabel: string;
  warehouse: GeoPoint;
}

// ---------- distance + trip packing (operational) ----------

function sequence(vendor: Vendor, wtrips: WorkingTrip[]): { trips: Trip[]; totalKm: number } {
  let pos = vendor.depot;
  let total = 0;
  const trips: Trip[] = [];
  for (const wt of wtrips) {
    let cur = pos;
    let d = 0;
    const legs = [];
    for (const b of wt.bookings) {
      const k = roadKm(cur, b.location);
      d += k;
      legs.push({ fromLabel: cur.label ?? "depot", toLabel: b.location.label ?? b.customerName, km: k });
      cur = b.location;
    }
    const kw = roadKm(cur, wt.warehouse);
    d += kw;
    legs.push({ fromLabel: cur.label ?? "stop", toLabel: wt.warehouse.label ?? "warehouse", km: kw });
    cur = wt.warehouse;
    pos = cur;
    total += d;
    trips.push({
      bookingIds: wt.bookings.map((b) => b.id),
      legs,
      distanceKm: round1(d),
      palletsUsed: round1(wt.bookings.reduce((s, b) => s + b.pallets, 0)),
      palletCapacity: vendor.vehicle.palletCapacity,
    });
  }
  total += roadKm(pos, vendor.depot);
  return { trips, totalKm: round1(total) };
}

function buildTrips(vendor: Vendor, bookings: Booking[]): WorkingTrip[] {
  const byWh = new Map<string, Booking[]>();
  for (const b of bookings) {
    const key = b.warehouse.label ?? `${b.warehouse.lat},${b.warehouse.lng}`;
    (byWh.get(key) ?? byWh.set(key, []).get(key)!).push(b);
  }
  const trips: WorkingTrip[] = [];
  const cap = effectiveCapacity(vendor.vehicle.type); // allow the accepted overage tolerance
  // Within a warehouse, batch by TYPE: all retrievals load together in ONE warehouse visit and get
  // delivered (e.g. two 3.5-pallet retrievals = 7 ≤ 7.5 ride together), and pickups form their own
  // trips. Greedily fill each trip to capacity, always taking the nearest order that still fits.
  for (const [, group] of byWh) {
    for (const type of ["retrieval", "pickup"] as const) {
      const pool = group.filter((b) => b.type === type).sort((a, b) => b.pallets - a.pallets);
      while (pool.length) {
        const ride = [pool.shift()!];
        let load = ride[0].pallets;
        for (;;) {
          const last = ride[ride.length - 1].location;
          let bestIdx = -1, bestKm = Infinity;
          for (let i = 0; i < pool.length; i++) {
            if (load + pool[i].pallets > cap + EPS) continue;
            const km = roadKm(last, pool[i].location);
            if (km < bestKm) { bestKm = km; bestIdx = i; }
          }
          if (bestIdx < 0) break;
          const o = pool.splice(bestIdx, 1)[0];
          ride.push(o); load += o.pallets;
        }
        trips.push({ bookings: ride, warehouseLabel: ride[0].warehouse.label ?? "wh", warehouse: ride[0].warehouse });
      }
    }
  }
  trips.sort((x, y) => roadKm(vendor.depot, x.bookings[0].location) - roadKm(vendor.depot, y.bookings[0].location));
  return trips;
}

// ---------- cost (pallet blocks) ----------

const palletsOf = (bookings: Booking[]) => round1(bookings.reduce((s, b) => s + b.pallets, 0));

function evaluate(vendor: Vendor, bookings: Booking[]) {
  const wt = buildTrips(vendor, bookings);
  const { trips, totalKm } = sequence(vendor, wt);
  const pallets = palletsOf(bookings);
  const feasible = pallets <= vendor.maxPalletsPerDay + EPS;
  // One vendor = one vehicle/day = one flat block, regardless of how the stops split into trips.
  return { trips, totalKm, pallets, cost: bookings.length ? REGION.transportPerBlock : 0, feasible };
}

// ---------- the waterfall ----------

export function optimize(date: string, city: string, bookings: Booking[], vendors: Vendor[]): OptimizationResult {
  const assignedTo = new Map<string, Booking[]>();
  const reasoning = new Map<string, string[]>();
  vendors.forEach((v) => {
    assignedTo.set(v.id, []);
    reasoning.set(v.id, []);
  });
  // Intercity orders (pickup AND retrieval) are NEVER auto-assigned to a regular vendor — they must
  // not mix with local orders. They stay out of allocation and surface in the schedule's "team to
  // assign" bucket at the very end, where the team picks an intercity vendor by hand.
  const teamAssigns = (b: Booking) => !!b.isIntercity;
  const manualUnassigned = bookings.filter(teamAssigns).map((b) => b.id);
  const remaining = new Set(bookings.filter((b) => !teamAssigns(b)).map((b) => b.id));
  const byId = new Map(bookings.map((b) => [b.id, b]));
  const palletsAt = (vId: string) => palletsOf(assignedTo.get(vId)!);

  const take = (vId: string, b: Booking, why: string) => {
    assignedTo.get(vId)!.push(b);
    reasoning.get(vId)!.push(why);
    remaining.delete(b.id);
  };
  // Teams reserved as the 2nd/3rd team of a big multi-team order — they take no other work.
  const consumed = new Set<string>();

  const nearestFitting = (v: Vendor, limit: number): Booking | null => {
    let best: Booking | null = null;
    let bestKm = Infinity;
    for (const id of remaining) {
      const b = byId.get(id)!;
      if (palletsAt(v.id) + b.pallets > limit + EPS) continue;
      const d = roadKm(v.depot, b.location) + (vehicleMismatch(v, b) ? VEHICLE_PENALTY_KM : 0);
      if (d < bestKm) {
        bestKm = d;
        best = b;
      }
    }
    return best;
  };

  // Priority group preference (A preferred over B over C; unset sits between B and C).
  const priRank = (v: Vendor) => ({ A: 0, B: 1, C: 2 } as Record<string, number>)[String(v.priorityGroup ?? "").toUpperCase()] ?? 1.5;
  const generals = vendors.filter((v) => v.tier === "general").sort((a, b) => priRank(a) - priRank(b));
  const nons = vendors.filter((v) => v.tier === "non_general");

  // Phase 1a — fill each Type A base block tightly (cap at the obligation, no overshoot) so the
  // prepaid 7-pallet blocks pack well first.
  for (const v of generals) {
    while (palletsAt(v.id) < v.palletObligation - EPS && remaining.size) {
      const b = nearestFitting(v, Math.min(v.palletObligation, v.maxPalletsPerDay));
      if (!b) break;
      const d = round1(roadKm(v.depot, b.location));
      take(v.id, b, `Type A obligation — the ${money(REGION.generalBaseBlockCost)} for 7 pallets is already committed, so filling it is free. ${b.location.label} is ${d}km away (${b.pallets}p).`);
    }
  }
  // Phase 1b — any A vendor still short of its obligation gets topped up even if that overshoots
  // the block. The obligation is a paid commitment, so honouring it comes before saving blocks.
  for (const v of generals) {
    while (palletsAt(v.id) < v.palletObligation - EPS && remaining.size) {
      const b = nearestFitting(v, v.maxPalletsPerDay);
      if (!b) break;
      take(v.id, b, `Topping up ${v.name} to its 7-pallet obligation (${b.location.label}, ${b.pallets}p).`);
    }
  }

  // Phase 1c — BIG orders (more than one team can carry) go to ONE vendor that has enough FREE teams
  // to cover the whole order together. The order is NEVER split; all the needed teams come from the
  // same vendor family and are reserved for it. If no vendor has enough free teams, the order is left
  // for the team to assign by hand (it must never be split across different vendors).
  const bigFirst = [...remaining].map((id) => byId.get(id)!).filter((b) => teamsNeeded(b.pallets) >= 2).sort((a, b) => b.pallets - a.pallets);
  for (const b of bigFirst) {
    if (!remaining.has(b.id)) continue;
    const need = teamsNeeded(b.pallets);
    // Free teams (empty + not already reserved), grouped by vendor family.
    const freeByFamily = new Map<string, Vendor[]>();
    for (const v of [...generals, ...nons]) {
      if (assignedTo.get(v.id)!.length > 0 || consumed.has(v.id)) continue;
      const f = vendorFamily(v.name);
      if (!freeByFamily.has(f)) freeByFamily.set(f, []);
      freeByFamily.get(f)!.push(v);
    }
    // Families that can field `need` teams whose combined capacity covers the order; pick the one
    // whose nearest team is closest to the stop.
    let bestPick: { primary: Vendor; siblings: Vendor[]; km: number } | null = null;
    for (const teams of freeByFamily.values()) {
      if (teams.length < need) continue;
      const byCap = [...teams].sort((x, y) => effectiveCapacity(y.vehicle.type) - effectiveCapacity(x.vehicle.type));
      const chosen = byCap.slice(0, need); // the `need` biggest teams of this family
      const capSum = chosen.reduce((s, v) => s + effectiveCapacity(v.vehicle.type), 0);
      if (capSum + EPS < b.pallets) continue; // even its biggest teams can't carry the order
      const primary = [...chosen].sort((x, y) => roadKm(x.depot, b.location) - roadKm(y.depot, b.location))[0];
      const km = roadKm(primary.depot, b.location);
      if (!bestPick || km < bestPick.km) bestPick = { primary, siblings: chosen.filter((v) => v.id !== primary.id), km };
    }
    if (bestPick) {
      b.coTeams = bestPick.siblings.map((s) => s.id); // remember the reserved 2nd/3rd teams
      take(bestPick.primary.id, b, `Big order (${b.pallets}p) — ${bestPick.primary.name} sends ${need} teams (order kept whole).`);
      for (const s of bestPick.siblings) consumed.add(s.id);
    }
    // else: leave in `remaining` → ends up in the "team to assign" bucket. Never split.
  }

  // Phase 2 — assign every order to a vendor, in TWO passes (the team's tiering policy):
  //   Pass 1: priority-A GENERAL vendors only — the contracted first line, filled to their capacity
  //           (proximity decides which A vendor takes which order; an order >A_PASS_MAX_KM from every
  //           A cluster waits for pass 2 rather than being dragged).
  //   Pass 2: everyone else. If MANY orders remain (≥ NON_GENERAL_BULK_THRESHOLD) the bulk
  //           non-general (Daksh: 6 transactions / 14 pallets / ₹15k) becomes as attractive as a
  //           general — great per-transaction value at volume. If only a few remain, generals stay
  //           cheaper (₹5-7.5k/day) and the non-general keeps its penalty.
  const runPass = (pool: Vendor[], overflowPass: boolean, maxClusterKm: number) => {
    // Baseline for the price tiebreak: the cheapest priced vendor available in this pass.
    const prices = pool.map((v) => v.dailyPrice).filter((p): p is number => p != null && p > 0);
    const minPrice = prices.length ? Math.min(...prices) : 0;
    // Bulk mode is DYNAMIC: while ≥ threshold orders still wait, the 6-transaction vendor is
    // preferred; once the pool shrinks below it, the remaining few go to cheaper general Bs.
    const bulkNow = () =>
      overflowPass && [...remaining].filter((id) => teamsNeeded(byId.get(id)!.pallets) < 2).length >= NON_GENERAL_BULK_THRESHOLD;
    let progressed = true;
    while (remaining.size && progressed) {
      progressed = false;
      // Big multi-team orders are only ever placed in Phase 1c; if one is still here, no vendor had
      // enough free teams, so leave it for the team (never force it onto a single overloaded vendor).
      const order = [...remaining].map((id) => byId.get(id)!).filter((b) => teamsNeeded(b.pallets) < 2).sort((a, b) => b.pallets - a.pallets);
      for (const b of order) {
        if (!remaining.has(b.id)) continue;
        const nonGeneralKm = bulkNow() ? NON_GENERAL_BULK_BONUS_KM : NON_GENERAL_KM;
        const fitting: { v: Vendor; p: number; opensNew: boolean }[] = [];
        for (const v of pool) {
          if (consumed.has(v.id)) continue; // reserved as a big order's 2nd/3rd team
          // Per-vendor daily transaction cap: generals 3; a bulk non-general carries its own (Daksh: 6).
          if (assignedTo.get(v.id)!.length >= (v.maxOrdersPerDay ?? MAX_ORDERS_PER_VENDOR)) continue;
          const p = palletsAt(v.id);
          const opensNew = p < EPS;
          const prospectiveTrips = buildTrips(v, [...assignedTo.get(v.id)!, b]).length;
          // HARD capacity: the order (assumed for pickups / actual for retrievals) plus the load already
          // on the vendor must fit the vendor's DAY — vehicle cap for generals (10ft 5 / 14ft 9), the
          // contracted day for a bulk non-general (Daksh 14 across 2 trips). Never overload.
          const fits = p + b.pallets <= v.maxPalletsPerDay + EPS && (opensNew || prospectiveTrips <= TRIPS_PER_DAY);
          if (fits) fitting.push({ v, p, opensNew });
        }
        let bestV: Vendor | null = null;
        let bestScore = Infinity;
        let bestOpensNew = false;
        if (fitting.length) {
          // Families of vendors already on the road — to keep a vendor's 2 teams working the same job.
          const openFamilies = new Set(vendors.filter((x) => assignedTo.get(x.id)!.length > 0).map((x) => vendorFamily(x.name)));
          for (const { v, p, opensNew } of fitting) {
            const wB = slotWindow(b);
            const conflict = !opensNew && !!wB && assignedTo.get(v.id)!.some((x) => windowsOverlap(slotWindow(x), wB));
            const clusterKm = Math.min(roadKm(v.depot, b.location), ...assignedTo.get(v.id)!.map((x) => roadKm(x.location, b.location)));
            if (clusterKm > maxClusterKm) continue; // too far for this pass — leave for the next one
            const priKm = priRank(v) * PRIORITY_TIEBREAK_KM; // secondary: nudges nearer→higher-priority
            // Everything in km-equivalents. Filling an open vehicle carries no surcharge; opening a new
            // one costs NEW_VEHICLE_KM — nearby orders consolidate, far orders open the free vendor next
            // to them instead of being dragged across the city.
            const score =
              clusterKm + priKm +
              (opensNew ? NEW_VEHICLE_KM : 0) +
              (conflict ? WINDOW_CONFLICT_KM : 0) + // nudge clashing windows onto a different NEAR vehicle
              (!opensNew ? -0.2 * p : 0) + // tiny tiebreak: top off the fuller of two equal vehicles
              (opensNew && openFamilies.has(vendorFamily(v.name)) ? -SIBLING_BONUS_KM : 0) + // prefer a working vendor's sibling team
              (v.tier === "non_general" ? nonGeneralKm : 0) + // volume decides how attractive the bulk vendor is
              (vehicleMismatch(v, b) ? VEHICLE_MISMATCH_KM : 0) +
              // LAST tiebreaks — only when opening a fresh vehicle (a running vehicle's cost is sunk):
              (opensNew && v.dailyPrice ? ((v.dailyPrice - minPrice) / 1000) * PRICE_KM_PER_1K : 0) + // cheaper vendor first
              (opensNew && v.tier === "general" && v.vehicle.type === "14ft" && b.pallets <= effectiveCapacity("10ft") + EPS ? SMALL_ON_14FT_KM : 0); // small load → small van
            if (score < bestScore) { bestScore = score; bestV = v; bestOpensNew = opensNew; }
          }
        }
        if (bestV) {
          const why = bestOpensNew
            ? `New vehicle for ${bestV.name} (${money(REGION.transportPerBlock)}/day) — nearest free vendor to ${b.location.label}.`
            : `Shares ${bestV.name}'s vehicle (already on the road, no extra ${money(REGION.transportPerBlock)}).`;
          take(bestV.id, b, why);
          progressed = true;
        }
      }
    }
  };

  // Pass 1 — the contracted priority-A generals take everything within reach first.
  const aGenerals = generals.filter((v) => String(v.priorityGroup ?? "").toUpperCase() === "A");
  if (aGenerals.length) runPass(aGenerals, false, A_PASS_MAX_KM);
  // Pass 2 — overflow. Volume (re-checked as orders place) decides the bulk vendor's attractiveness.
  runPass([...generals, ...nons], true, Infinity);

  // ---------- assemble ----------
  const assignments: Assignment[] = [];
  for (const v of vendors) {
    const bs = assignedTo.get(v.id)!;
    if (bs.length === 0) continue;
    const e = evaluate(v, bs);
    assignments.push({
      vendorId: v.id,
      bookingIds: bs.map((b) => b.id),
      trips: e.trips,
      ordersCount: bs.length,
      palletsAssigned: e.pallets,
      distanceKm: e.totalKm,
      cost: e.cost,
      reasoning: reasoning.get(v.id)!,
    });
  }
  const unassigned = [...remaining, ...manualUnassigned];

  const obligations = buildObligations(vendors, (id) => palletsAt(id));
  const comparison = compareToManual(bookings, vendors, assignments);
  return assembleResult(date, city, bookings, vendors, assignments, unassigned, obligations, comparison);
}

// ---------- shared assembly ----------

function buildObligations(vendors: Vendor[], palletsAt: (id: string) => number): ObligationStatus[] {
  return vendors
    .filter((v) => v.palletObligation > 0)
    .map((v) => {
      const assigned = round1(palletsAt(v.id));
      const shortBy = round1(Math.max(0, v.palletObligation - assigned));
      return {
        vendorId: v.id,
        vendorName: v.name,
        tier: v.tier,
        required: v.palletObligation,
        assigned,
        met: shortBy <= EPS,
        shortBy,
        severity: shortBy <= EPS ? "ok" : "breach",
      };
    });
}

function assembleResult(
  date: string,
  city: string,
  bookings: Booking[],
  vendors: Vendor[],
  assignments: Assignment[],
  unassigned: string[],
  obligations: ObligationStatus[],
  comparison: PlanComparison,
): OptimizationResult {
  const totalPalletsUsed = assignments.reduce((s, a) => s + a.palletsAssigned, 0);
  const totalCapacity = assignments.reduce((s, a) => s + a.trips.reduce((t, tr) => t + tr.palletCapacity, 0), 0);
  const consolidatedTrips = assignments.reduce((s, a) => s + a.trips.filter((t) => t.bookingIds.length > 1).length, 0);
  const totalTrips = assignments.reduce((s, a) => s + a.trips.length, 0);
  const cost = comparison.optimizedCost;
  return {
    date, city, bookings, vendors, assignments, unassigned, obligations, comparison,
    kpis: {
      totalBookings: bookings.length,
      totalPallets: round1(bookings.reduce((s, b) => s + b.pallets, 0)),
      vendorsActive: assignments.length,
      totalTrips,
      palletUtilization: totalCapacity ? totalPalletsUsed / totalCapacity : 0,
      avgCostPerBooking: bookings.length ? Math.round(cost / bookings.length) : 0,
      consolidatedTrips,
    },
  };
}

// Reflect the ACTUAL manual plan as-is (group by existing team), no re-optimisation.
export function buildManualResult(date: string, city: string, bookings: Booking[], vendors: Vendor[]): OptimizationResult {
  const groups = new Map<string, Booking[]>();
  const unassigned: string[] = [];
  for (const b of bookings) {
    if (!b.currentVendorId) { unassigned.push(b.id); continue; }
    (groups.get(b.currentVendorId) ?? groups.set(b.currentVendorId, []).get(b.currentVendorId)!).push(b);
  }
  const vById = new Map(vendors.map((v) => [v.id, v]));
  const assignments: Assignment[] = [];
  for (const [vId, bs] of groups) {
    const v = vById.get(vId);
    if (!v) continue;
    const e = evaluate(v, bs);
    assignments.push({
      vendorId: vId, bookingIds: bs.map((b) => b.id), trips: e.trips, ordersCount: bs.length,
      palletsAssigned: e.pallets, distanceKm: e.totalKm, cost: e.cost,
      reasoning: [`Actual team on the manual schedule for ${bs.length} order(s).`],
    });
  }
  const palletsAt = (id: string) => palletsOf(groups.get(id) ?? []);
  const obligations = buildObligations(vendors, palletsAt);
  const comparison = compareToManual(bookings, vendors, assignments);
  return assembleResult(date, city, bookings, vendors, assignments, unassigned, obligations, comparison);
}

function planCost(vendors: Vendor[], palletsBy: Map<string, number>): number {
  // One vendor used = one vehicle = one flat block. No obligation, so idle vendors cost nothing.
  let total = 0;
  for (const v of vendors) {
    const p = palletsBy.get(v.id) ?? 0;
    if (p > EPS) total += REGION.transportPerBlock;
  }
  return total;
}

function compareToManual(bookings: Booking[], vendors: Vendor[], optimized: Assignment[]): PlanComparison {
  const vById = new Map(vendors.map((v) => [v.id, v]));
  const generalIds = new Set(vendors.filter((v) => v.tier === "general").map((v) => v.id));
  const nonGenIds = new Set(vendors.filter((v) => v.tier === "non_general").map((v) => v.id));

  // manual pallets + km
  const manualBy = new Map<string, number>();
  let manualKm = 0;
  const manualGroups = new Map<string, Booking[]>();
  for (const b of bookings) {
    if (!b.currentVendorId) continue;
    (manualGroups.get(b.currentVendorId) ?? manualGroups.set(b.currentVendorId, []).get(b.currentVendorId)!).push(b);
  }
  for (const [vId, bs] of manualGroups) {
    const v = vById.get(vId);
    if (!v) continue;
    manualBy.set(vId, palletsOf(bs));
    manualKm += evaluate(v, bs).totalKm;
  }

  const optBy = new Map<string, number>();
  optimized.forEach((a) => optBy.set(a.vendorId, a.palletsAssigned));

  const obligation = REGION.generalObligationPallets;
  const filled = (by: Map<string, number>) =>
    vendors.filter((v) => v.tier === "general" && (by.get(v.id) ?? 0) >= obligation - EPS).length;
  const nonGenPallets = (by: Map<string, number>) =>
    [...by.entries()].filter(([id]) => nonGenIds.has(id)).reduce((s, [, p]) => s + p, 0);

  const manualCost = planCost(vendors, manualBy);
  const optimizedCost = planCost(vendors, optBy);
  const optimizedKm = round1(optimized.reduce((s, a) => s + a.distanceKm, 0));

  return {
    optimizedCost,
    manualCost,
    costSaved: manualCost - optimizedCost,
    optimizedKm,
    manualKm: round1(manualKm),
    kmSaved: round1(manualKm - optimizedKm),
    optimizedVendorsUsed: optimized.length,
    manualVendorsUsed: manualGroups.size,
    generalTotal: generalIds.size,
    manualGeneralFilled: filled(manualBy),
    optimizedGeneralFilled: filled(optBy),
    manualNonGenPallets: round1(nonGenPallets(manualBy)),
    optimizedNonGenPallets: round1(nonGenPallets(optBy)),
  };
}

function money(n: number): string {
  return `${REGION.currencySymbol}${Math.round(n).toLocaleString("en-IN")}`;
}
