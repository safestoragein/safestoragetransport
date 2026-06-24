-- SafeStorage Transport — 07_pickup_pallet_buffer.sql
-- Pickups: customers under-report pallets, so we SCHEDULE for stated + buffer (e.g. 5 -> 7) while
-- keeping the customer-stated count for reference. `orders.pallets` now holds the scheduled count;
-- this adds the stated count alongside it. Re-runnable.
alter table safestorage.orders
  add column if not exists stated_pallets numeric(5,1);
