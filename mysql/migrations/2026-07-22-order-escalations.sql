-- Escalations module: one row per escalated order (raised from the Feedback page — damage found
-- later, missing item, negative review, etc.). Safe to run more than once.
CREATE TABLE IF NOT EXISTS sst_order_escalations (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  order_key  VARCHAR(64)  NOT NULL,             -- orders.id (uuid) or "wms:<order_id>"
  customer_unique_id VARCHAR(32) NULL,
  customer_name      VARCHAR(191) NULL,
  contact            VARCHAR(64)  NULL,
  city               VARCHAR(64)  NULL,
  order_type         VARCHAR(32)  NULL,
  is_intercity       TINYINT(1)   NOT NULL DEFAULT 0,
  vendor_name        VARCHAR(191) NULL,          -- which vendor ran the job (editable)
  escalation_type    VARCHAR(40)  NULL,          -- damage / missing_item / negative_review / payment / behaviour / other
  issue              TEXT         NULL,          -- what the customer reported
  raised_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  raised_by          VARCHAR(120) NULL,          -- transport user who raised it
  eta                DATE         NULL,          -- target resolution date
  status             VARCHAR(20)  NOT NULL DEFAULT 'open',  -- open / working / resolved
  fault_side         VARCHAR(20)  NULL,          -- ours / vendor / customer / unknown
  resolution_type    VARCHAR(40)  NULL,          -- refund / replacement / repair / compensation / apology_call / other
  amount_spent       DECIMAL(10,2) NULL,         -- what it cost us to resolve
  resolution_notes   TEXT         NULL,          -- how we resolved it
  resolved_at        TIMESTAMP    NULL,
  updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sst_escalation_order (order_key),
  KEY idx_sst_escalations_status (status),
  KEY idx_sst_escalations_raised (raised_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- WMS-reported linkage: the warehouse team raises missing/damage issues in their own system
-- (get_wms_reported_issues). If one exists for the customer when we escalate, it's auto-marked.
ALTER TABLE sst_order_escalations ADD COLUMN IF NOT EXISTS wms_reported TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE sst_order_escalations ADD COLUMN IF NOT EXISTS wms_ref TEXT NULL;
