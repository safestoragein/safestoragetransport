-- When the customer BOOKED the order (feed's order_created_at). Powers the schedule chip
-- "booked 10 Jul (5 days ago)". The live table predates this column, so the order upsert has
-- been silently skipping it. Safe to run more than once.
ALTER TABLE sst_orders ADD COLUMN IF NOT EXISTS booking_date VARCHAR(32) NULL AFTER order_status;
