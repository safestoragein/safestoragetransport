-- Store the customer's storage fee (feed field `storage_charges`) per order, shown in the schedule.
-- Populated for pickups; null for retrievals. Safe to run more than once (IF NOT EXISTS).
ALTER TABLE sst_orders ADD COLUMN IF NOT EXISTS storage_charges DECIMAL(12,2) NULL AFTER packing_charge;
