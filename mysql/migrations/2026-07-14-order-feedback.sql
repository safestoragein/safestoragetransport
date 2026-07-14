-- Feedback & escalations, one row per completed order (keyed by sst_orders.id).
-- Remarks + source of lead are team-editable; the escalation trio (outcome / assigned team /
-- resolved status) drives the red-row escalation workflow. Safe to run more than once.
CREATE TABLE IF NOT EXISTS sst_order_feedback (
  order_id CHAR(36) NOT NULL PRIMARY KEY,
  remarks TEXT NULL,
  source_of_lead VARCHAR(100) NULL,
  outcome VARCHAR(20) NULL,
  assigned_team VARCHAR(100) NULL,
  resolved_status VARCHAR(30) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
