-- Customer email from the work-order feed (customer_email). The team needs it on the schedule and
-- on the printed inventory/delivery sheet — the old WMS sheet always showed it. Safe to re-run.
ALTER TABLE sst_orders ADD COLUMN IF NOT EXISTS customer_email VARCHAR(191) NULL AFTER contact;
