-- Calls can be raised into the WMS ticket system, same as the email tickets. Stores the id their
-- API returns so a call can't be raised twice and the two systems stay linked.
-- Safe to run more than once.
ALTER TABLE sst_ret_calls ADD COLUMN IF NOT EXISTS external_ticket_id VARCHAR(64) NULL AFTER notes;
ALTER TABLE sst_ret_calls ADD COLUMN IF NOT EXISTS external_synced_at TIMESTAMP  NULL AFTER external_ticket_id;
ALTER TABLE sst_ret_calls ADD COLUMN IF NOT EXISTS external_error     TEXT       NULL AFTER external_synced_at;
