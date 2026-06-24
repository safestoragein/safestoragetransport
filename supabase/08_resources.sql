-- SafeStorage Transport — 08_resources.sql
-- A trip <=7 pallets is one ₹7,000 block. For heavier loads the team adds a manual labour
-- "resource" (₹800 each) instead of a second vehicle. This stores the resource count per
-- assigned order; ops toggle it from the schedule. Re-runnable.
alter table safestorage.schedule_assignments
  add column if not exists resources integer not null default 0;
