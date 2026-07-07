-- Manual stop order: when the team drags/interchanges a vendor's stops, we store an explicit
-- 1..N sequence here. When any stop in a vendor has manual_seq set, that order wins over the
-- automatic morning/afternoon + nearest-stop plan (both the badges and the recomputed ETAs).
-- NULL = follow the automatic plan (default). Safe to run more than once (IF NOT EXISTS).
ALTER TABLE sst_schedule_assignments ADD COLUMN IF NOT EXISTS manual_seq INT NULL AFTER stop_seq;
