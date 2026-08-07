-- Retrieval → Calls. Call records pulled from Knowlarity (Super Receptionist) for the retrieval
-- SR number, matched to a customer by the caller's phone number the same way emails are.
-- Safe to run more than once.
CREATE TABLE IF NOT EXISTS sst_ret_calls (
  id                 CHAR(36)     NOT NULL PRIMARY KEY,
  call_uuid          VARCHAR(64)  NOT NULL,            -- Knowlarity uuid — dedupes re-reads
  sr_number          VARCHAR(24)  NULL,                -- the number the customer dialled
  extension          VARCHAR(8)   NULL,                -- IVR option chosen (retrieval = 1 / 2)
  direction          VARCHAR(12)  NOT NULL DEFAULT 'inbound',
  customer_number    VARCHAR(24)  NULL,
  caller_name        VARCHAR(191) NULL,
  agent_number       VARCHAR(24)  NULL,
  started_at         TIMESTAMP    NULL,
  duration_sec       INT          NOT NULL DEFAULT 0,  -- 0 = missed / not connected
  answered           TINYINT(1)   NOT NULL DEFAULT 0,
  recording_url      TEXT         NULL,

  -- who called (resolved from the number against the order history)
  customer_id        VARCHAR(32)  NULL,
  customer_unique_id VARCHAR(32)  NULL,
  customer_name      VARCHAR(191) NULL,
  city               VARCHAR(64)  NULL,

  -- the team's working fields
  status             VARCHAR(24)  NOT NULL DEFAULT 'new',   -- new | in_progress | resolved
  request_type       VARCHAR(24)  NULL,                     -- same categories as the email tickets
  assigned_to        VARCHAR(120) NULL,
  notes              TEXT         NULL,
  created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_sst_ret_call (call_uuid),
  KEY idx_sst_ret_call_time (started_at),
  KEY idx_sst_ret_call_cust (customer_unique_id),
  KEY idx_sst_ret_call_num (customer_number),
  KEY idx_sst_ret_call_ext (extension)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sst_ret_call_sync (
  id              INT          NOT NULL PRIMARY KEY DEFAULT 1,
  last_call_at    TIMESTAMP    NULL,
  last_synced_at  TIMESTAMP    NULL,
  last_status     VARCHAR(24)  NULL,
  last_error      TEXT         NULL,
  calls_seen      INT          NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO sst_ret_call_sync (id, last_call_at) VALUES (1, DATE_SUB(NOW(), INTERVAL 7 DAY));
