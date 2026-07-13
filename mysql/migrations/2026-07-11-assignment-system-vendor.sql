-- Snapshot of the OPTIMIZER's vendor choice, written once at Generate and never edited.
-- vendor_id / vendor_name remain the FINAL (team-editable) allocation; comparing the two
-- shows exactly what the team overrode. Safe to run more than once.
ALTER TABLE sst_schedule_assignments ADD COLUMN IF NOT EXISTS system_vendor_id CHAR(36) NULL AFTER vendor_name;
ALTER TABLE sst_schedule_assignments ADD COLUMN IF NOT EXISTS system_vendor_name VARCHAR(255) NULL AFTER system_vendor_id;
