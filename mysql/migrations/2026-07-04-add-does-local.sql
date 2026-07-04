-- Add a "does_local" flag to the vendor master.
-- Meaning: does this vendor also do LOCAL pickup/retrieval work?
--   does_local = 1  -> included in the local scheduling pool (even if it's an intercity vendor)
--   does_local = 0  -> excluded from local scheduling (intercity-only)
--
-- Run this once in phpMyAdmin (database: safestor_india).

ALTER TABLE sst_vendors
  ADD COLUMN does_local TINYINT(1) NOT NULL DEFAULT 1 AFTER is_intercity_vendor;

-- Preserve current behaviour: intercity vendors start as NOT doing local.
-- Then flip the intercity vendors that ALSO do local to 1 (from the Vendor panel, or here).
UPDATE sst_vendors SET does_local = 0 WHERE is_intercity_vendor = 1;
