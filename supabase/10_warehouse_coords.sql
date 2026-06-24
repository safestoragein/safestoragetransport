-- SafeStorage Transport — 10_warehouse_coords.sql
-- Store the warehouse lat/lng on each order so the day-plan can compute REAL travel time to/from
-- the warehouse (instead of a flat estimate). Re-runnable.
alter table safestorage.orders
  add column if not exists warehouse_lat double precision,
  add column if not exists warehouse_lng double precision;
