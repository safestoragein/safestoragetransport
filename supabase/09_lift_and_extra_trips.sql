-- SafeStorage Transport — 09_lift_and_extra_trips.sql
-- (a) Whether a lift is available at the pickup/drop site (drives the labour-resource decision).
-- (b) Optional, feasible 3rd trip on a vendor (+₹1,500) — stored per vendor per run. Re-runnable.

alter table safestorage.orders
  add column if not exists lift text;

create table if not exists safestorage.schedule_vendor_addons (
  run_id      uuid not null references safestorage.schedule_runs(id) on delete cascade,
  vendor_key  text not null,            -- vendor name (stable across reassignment)
  extra_trips integer not null default 0,
  primary key (run_id, vendor_key)
);

grant all    on table safestorage.schedule_vendor_addons to service_role;
grant select on table safestorage.schedule_vendor_addons to anon, authenticated;
