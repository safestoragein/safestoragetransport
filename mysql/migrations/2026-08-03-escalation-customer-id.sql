-- Escalations must be keyed to the WMS's NUMERIC customer_id, not the human booking code:
-- customer_unique_id (BH26174…) is a display label — it can repeat, and shifting bookings have
-- none at all, so joining an escalation back to a customer by that code can hit the wrong person.
-- customer_unique_id stays for the team to read on screen. Safe to run more than once.
ALTER TABLE sst_order_escalations ADD COLUMN IF NOT EXISTS customer_id VARCHAR(32) NULL AFTER order_key;
CREATE INDEX IF NOT EXISTS idx_sst_escalations_customer ON sst_order_escalations (customer_id);
