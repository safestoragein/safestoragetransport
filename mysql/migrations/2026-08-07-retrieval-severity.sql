-- Retrieval tickets: severity read from the mail CONTENT (legal threats, damage/loss, refund
-- demands, urgency…) so priority reflects both "how often" and "how bad"; severity_reason records
-- WHY, so a P1 is never unexplained. issue_type tags what the mail is actually about, using the
-- team's own categories. Safe to run more than once.
ALTER TABLE sst_ret_tickets ADD COLUMN IF NOT EXISTS severity        VARCHAR(12)  NULL AFTER priority;
ALTER TABLE sst_ret_tickets ADD COLUMN IF NOT EXISTS severity_reason VARCHAR(255) NULL AFTER severity;
ALTER TABLE sst_ret_tickets ADD COLUMN IF NOT EXISTS issue_type      VARCHAR(24)  NULL AFTER category;
CREATE INDEX IF NOT EXISTS idx_sst_ret_issue ON sst_ret_tickets (issue_type);
