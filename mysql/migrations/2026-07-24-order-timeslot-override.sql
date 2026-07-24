-- Manual time-slot edits made on the schedule must survive feed re-pulls (Pull changes / rate
-- sync used to reset them to the booking system's original slot). Safe to run more than once.
ALTER TABLE sst_orders ADD COLUMN IF NOT EXISTS time_slot_override VARCHAR(40) NULL;
