-- Severity read from the MAIL CONTENT (legal threats, damage/loss, refund demands, urgency…),
-- kept alongside the chase count so priority reflects both "how often" and "how bad".
-- severity_reason records WHY, so a P1 is never unexplained. Safe to run more than once.
ALTER TABLE sst_ret_tickets ADD COLUMN IF NOT EXISTS severity        VARCHAR(12)  NULL AFTER priority;
ALTER TABLE sst_ret_tickets ADD COLUMN IF NOT EXISTS severity_reason VARCHAR(255) NULL AFTER severity;
