-- SafeStorage Transport — 11_vendor_resources.sql
-- The ₹800 labour resource is per VENDOR per DAY (one extra helper for the whole day), not per
-- order. Store the count alongside extra_trips on the per-vendor add-ons table. Re-runnable.
alter table safestorage.schedule_vendor_addons
  add column if not exists resources integer not null default 0;
