// Filter an OptimizationResult to one order category (pickup / full_retrieval / partial_retrieval),
// pruning trips/assignments to the kept bookings and recomputing KPIs so every downstream
// component (P&L, timeline, map, lists) works on the slice.

import { OptimizationResult, OrderCategory, Booking } from "./types";
import { round1 } from "./geo";

const catOf = (b: Booking): OrderCategory =>
  b.category ?? (b.type === "retrieval" ? "full_retrieval" : "pickup");

export type Scope = OrderCategory | "all";

export function filterByScope(result: OptimizationResult, scope: Scope): OptimizationResult {
  if (scope === "all") return result;
  const bookings = result.bookings.filter((b) => catOf(b) === scope);
  const keep = new Set(bookings.map((b) => b.id));
  const byId = new Map(bookings.map((b) => [b.id, b]));

  const assignments = result.assignments
    .map((a) => {
      const bookingIds = a.bookingIds.filter((id) => keep.has(id));
      if (bookingIds.length === 0) return null;
      const trips = a.trips
        .map((t) => {
          const ids = t.bookingIds.filter((id) => keep.has(id));
          return { ...t, bookingIds: ids, palletsUsed: round1(ids.reduce((s, id) => s + (byId.get(id)?.pallets ?? 0), 0)) };
        })
        .filter((t) => t.bookingIds.length > 0);
      const palletsAssigned = round1(bookingIds.reduce((s, id) => s + (byId.get(id)?.pallets ?? 0), 0));
      return { ...a, bookingIds, trips, ordersCount: bookingIds.length, palletsAssigned };
    })
    .filter(Boolean) as OptimizationResult["assignments"];

  const totalPalletsUsed = assignments.reduce((s, a) => s + a.trips.reduce((t, tr) => t + tr.palletsUsed, 0), 0);
  const totalCapacity = assignments.reduce((s, a) => s + a.trips.reduce((t, tr) => t + tr.palletCapacity, 0), 0);

  return {
    ...result,
    bookings,
    assignments,
    unassigned: result.unassigned.filter((id) => keep.has(id)),
    kpis: {
      ...result.kpis,
      totalBookings: bookings.length,
      totalPallets: round1(bookings.reduce((s, b) => s + b.pallets, 0)),
      vendorsActive: assignments.length,
      totalTrips: assignments.reduce((s, a) => s + a.trips.length, 0),
      consolidatedTrips: assignments.reduce((s, a) => s + a.trips.filter((t) => t.bookingIds.length > 1).length, 0),
      palletUtilization: totalCapacity ? totalPalletsUsed / totalCapacity : 0,
    },
  };
}

export function countByCategory(result: OptimizationResult): Record<OrderCategory, number> {
  const c: Record<OrderCategory, number> = { pickup: 0, full_retrieval: 0, partial_retrieval: 0 };
  for (const b of result.bookings) c[catOf(b)]++;
  return c;
}

export function timeRequests(result: OptimizationResult): Booking[] {
  return result.bookings.filter((b) => b.requiredTimeText);
}
