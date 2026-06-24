-- Editable app settings (key/value). Currently holds the packing-material cost per pallet so
-- ops can tune it from the dashboard without a redeploy.
create table if not exists safestorage.settings (
  key        text primary key,
  value      numeric not null,
  updated_at timestamptz not null default now()
);

insert into safestorage.settings (key, value)
values ('packing_per_pallet', 2000)
on conflict (key) do nothing;

-- Grants (service_role does the reads/writes from the app; safe to re-run)
grant usage  on schema safestorage          to anon, authenticated, service_role;
grant all    on table  safestorage.settings to service_role;
grant select on table  safestorage.settings to anon, authenticated;
