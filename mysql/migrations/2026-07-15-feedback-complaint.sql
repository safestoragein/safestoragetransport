-- Internal-complaint ticket tracking on feedback rows: when a NEGATIVE outcome gets a team
-- assigned, a ticket is raised once via add_internal_complaint_api; these columns remember it
-- (so repeat edits never raise duplicates). Safe to run more than once.
ALTER TABLE sst_order_feedback
  ADD COLUMN IF NOT EXISTS complaint_raised_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS complaint_ref VARCHAR(191) NULL;
