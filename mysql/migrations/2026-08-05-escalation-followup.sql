-- Follow-up tracking on escalations: the team records when they will next chase the issue and
-- what was said, and the reports show a TAT measured against that follow-up date.
-- (The warehouse team's own issues already carry these in the WMS; this is our side of it.)
-- Safe to run more than once.
ALTER TABLE sst_order_escalations ADD COLUMN IF NOT EXISTS followup_date  DATE NULL AFTER eta;
ALTER TABLE sst_order_escalations ADD COLUMN IF NOT EXISTS followup_notes TEXT NULL AFTER followup_date;
