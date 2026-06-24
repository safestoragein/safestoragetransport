# SafeStorage · Smart Transport Module

A modern, country-agnostic **vendor-allocation** layer for SafeStorage transport operations.
It ingests bookings and vendors from the existing system (read-only), then assigns the right
vendor to each booking to **minimise total daily cost** — and shows, side by side, how much
cheaper that is than the current manual plan.

It never writes to the existing system. It is a recommendation / "shadow" layer.

## Run it

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
```

Out of the box it runs on a bundled **sample day** (16 Hyderabad bookings, 8 vendors) so the
dashboard works with zero configuration.

## The allocation logic (`lib/optimizer.ts`)

A cost-aware **waterfall** built around SafeStorage's vendor economics:

| Tier | Rule | Why it matters |
|------|------|----------------|
| **General (A)** | must get 2 orders/day · paid **weekly** · 100 km daily route cap | Prepaid → near-zero marginal cost → **fill first** |
| **Contracted (B)** | must get 2/day · up to 6 · paid per order | Cheap incremental capacity |
| **On-request (C)** | no obligation · paid per order | Premium overflow → **use last** |

1. **Phase 1** — fill every General vendor's 2 prepaid slots with the nearest feasible orders (within 100 km).
2. **Phase 2** — fill every Contracted vendor's 2-order minimum.
3. **Phase 3** — distribute the rest to the least-marginal-cost vendor, packing two customers
   onto one trip when pallets fit (14ft = 7 pallets, 10ft = 4) and they share a warehouse.

The result is explainable: every assignment carries a plain-English "why".

## Country-agnostic cost model (`lib/config.ts`)

Currency, distance unit, per-km cost, per-tier order cost, the 100 km cap and obligation
floors all live in one `RegionConfig`. Swap that object to run the same engine in any country —
the optimizer never changes.

## Wiring live data (`lib/safestorage-api.ts`)

This is the only module that talks to the existing backend, and it only **reads**. Set:

```bash
SAFESTORAGE_API_BASE=https://safestorage.in/back
SAFESTORAGE_API_TOKEN=...      # from auth/login_remote_edit_inventory
```

It then calls the existing endpoints and normalises them into the domain model:

- `transport_controller_Dev0/get_work_order_list_api_new` → bookings
- `transport_controller_Dev0/get_users` + `get_vehicle_list_api` → vendors + vehicles (14ft/10ft, pallets)
- `transport_controller_Dev0/get_all_cities_with_warehouses` → warehouses
- `transport_controller_Dev0/get_and_show_assigned_order_data` → existing manual plan (for the savings comparison)
- `transport_controller_Dev0/get_pickup_order_list_of_items` → pallets per order

The normaliser field-mappings in that file are the only thing to confirm against the real payloads.

## Real-time vs planned

Recommended operating model = **rolling horizon with a freeze window**:
- T-7d → T-48h: re-optimise as bookings arrive (fluid).
- T-48h → T-24h: notify vendors, freeze obligations.
- T-24h → service day: absorb new bookings / cancellations into open capacity only (no thrash).

`GET /api/optimize?date=YYYY-MM-DD&city=Hyderabad` returns the full plan as JSON — this is what
a real-time front-end polls during the live-absorb window.

## Layout

```
lib/        types · config (cost model) · geo · optimizer · safestorage-api · mock-data
app/        page.tsx (server: load → optimize) · api/optimize · components/ (dashboard UI)
```
