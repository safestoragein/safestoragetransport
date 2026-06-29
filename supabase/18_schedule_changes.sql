-- SafeStorage Transport — 18_schedule_changes.sql
-- Post-cutoff booking changes (from the booking-system webhook, or the polling reconciler). Each row
-- is one change event; the UI highlights unhandled ones for manual assignment. Re-runnable.
create table if not exists safestorage.schedule_changes (
  id                 uuid primary key default gen_random_uuid(),
  order_id           text,
  customer_unique_id text,
  city               text,
  service_date       date,
  event              text,            -- created | rescheduled | cancelled | updated
  order_type         text,
  is_intercity       boolean,
  time_slot          text,
  order_status       text,
  source             text not null default 'webhook',  -- webhook | poll
  payload            jsonb,
  handled            boolean not null default false,
  received_at        timestamptz not null default now()
);
create index if not exists schedule_changes_open_idx on safestorage.schedule_changes (service_date, handled);

grant all privileges on table safestorage.schedule_changes to service_role;
notify pgrst, 'reload schema';
