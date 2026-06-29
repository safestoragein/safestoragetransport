-- SafeStorage Transport — 19_intercity_profit.sql
-- Manual profit the team records on an intercity order (intercity pricing is negotiated per trip, so
-- the system can't auto-compute it). Stored on the order's assignment row. Re-runnable.
alter table safestorage.schedule_assignments
  add column if not exists intercity_profit numeric;

notify pgrst, 'reload schema';
