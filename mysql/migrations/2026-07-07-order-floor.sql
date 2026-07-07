-- Store the site FLOOR alongside the lift flag on each order (raw feed value: "1", "9", "NA", …).
-- Shown next to the lift badge in the schedule so the team knows the carry before dispatch.
-- Safe to run more than once (IF NOT EXISTS).
ALTER TABLE sst_orders ADD COLUMN IF NOT EXISTS floor VARCHAR(16) NULL AFTER lift;
