-- Manual pallet edits made on the schedule. Pallets are now DERIVED (storage_charges / 1000),
-- never pulled from the booking feed — this column is the only thing that beats the formula,
-- so a team correction survives every regenerate. Safe to run more than once.
ALTER TABLE sst_orders ADD COLUMN IF NOT EXISTS pallet_override DECIMAL(6,1) NULL AFTER stated_pallets;
