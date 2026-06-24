// "Manual plan health check" — flags problems in the team's actual schedule using only
// the sheet (no vendor master needed). This is what makes the real-data view actionable.

import { OptimizationResult } from "./types";
import { effectiveCapacity } from "./config";

const MAX_VEHICLE_PALLETS = effectiveCapacity("14ft"); // largest single-vehicle load incl. tolerance (7.5)

export interface Finding {
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
}

export interface Diagnostics {
  findings: Finding[];
  intercityCount: number;
  rescheduledCount: number;
  unassignedCount: number;
  busiestTeam?: { name: string; orders: number };
  capacityOverloads: number;
}

export function diagnose(
  result: OptimizationResult,
  extras: { intercity: string[]; rescheduled: { refNo: string; note: string }[]; smallVehicleTeams: string[] },
): Diagnostics {
  const findings: Finding[] = [];
  const byId = new Map(result.bookings.map((b) => [b.id, b]));
  const vById = new Map(result.vendors.map((v) => [v.id, v]));

  // 1. Single bookings larger than any single vehicle (14ft max incl. 0.5 tolerance = 7.5)
  const oversize = result.bookings.filter((b) => b.pallets > MAX_VEHICLE_PALLETS);
  for (const b of oversize) {
    findings.push({
      severity: "high",
      title: `${b.refNo} is ${b.pallets} pallets — exceeds a 14ft vehicle (max ${MAX_VEHICLE_PALLETS})`,
      detail: `A single ${b.pallets}-pallet job needs to be split across trips or assigned a second vehicle. Flag at booking time.`,
    });
  }

  // 2. A booking that exceeds its assigned vehicle's effective capacity (incl. tolerance)
  for (const a of result.assignments) {
    const v = vById.get(a.vendorId);
    if (!v) continue;
    const cap = effectiveCapacity(v.vehicle.type);
    const over = a.bookingIds.map((id) => byId.get(id)!).filter((b) => b.pallets > cap);
    for (const b of over) {
      findings.push({
        severity: "high",
        title: `${b.refNo} (${b.pallets}p) overloads ${v.name} — ${v.vehicle.type} holds up to ${cap}`,
        detail: `This load does not fit the assigned vehicle in one trip. Reassign to a 14ft team or split.`,
      });
    }
  }

  // 3. Over-stacked teams (many orders on one team while others are light)
  const counts = result.assignments.map((a) => ({ name: vById.get(a.vendorId)?.name ?? a.vendorId, orders: a.ordersCount }));
  const busiest = counts.sort((x, y) => y.orders - x.orders)[0];
  for (const c of counts) {
    if (c.orders >= 5) {
      findings.push({
        severity: "medium",
        title: `${c.name} has ${c.orders} orders today`,
        detail: `Heavy single-team load. Redistributing to lighter teams shortens routes and reduces overtime risk.`,
      });
    }
  }

  // 4. Unassigned
  if (result.unassigned.length) {
    const refs = result.unassigned.map((id) => byId.get(id)?.refNo).filter(Boolean).join(", ");
    findings.push({
      severity: "high",
      title: `${result.unassigned.length} booking(s) have no team assigned`,
      detail: `${refs} — needs allocation before the service day.`,
    });
  }

  // 5. Intercity — handled separately from local routing
  if (extras.intercity.length) {
    findings.push({
      severity: "low",
      title: `${extras.intercity.length} intercity order(s)`,
      detail: `${extras.intercity.join(", ")} — long-haul jobs, excluded from the local 2-order / route-cap logic and costed separately.`,
    });
  }

  return {
    findings,
    intercityCount: extras.intercity.length,
    rescheduledCount: extras.rescheduled.length,
    unassignedCount: result.unassigned.length,
    busiestTeam: busiest,
    capacityOverloads: findings.filter((f) => f.title.includes("overloads") || f.title.includes("exceeds")).length,
  };
}
