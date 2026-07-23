-- Relationship manager per order (relationship_manager_name from the work-order feed).
-- Safe to run more than once.
ALTER TABLE sst_orders ADD COLUMN IF NOT EXISTS relationship_manager VARCHAR(120) NULL;
