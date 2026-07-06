-- Vendor app: KYC + pickup/delivery proof photos captured on a job, stored in the transport DB.
-- Run once in phpMyAdmin (database: safestor_india).

CREATE TABLE IF NOT EXISTS sst_order_photos (
  id           CHAR(36)     NOT NULL,
  order_id     CHAR(36)     NOT NULL,           -- -> sst_orders.id
  vendor_id    CHAR(36)     NULL,               -- -> sst_vendors.id (who uploaded)
  kind         VARCHAR(16)  NOT NULL,           -- 'kyc' | 'pickup' | 'delivery' | 'damage'
  filename     VARCHAR(255) NULL,
  content_type VARCHAR(120) NULL,
  byte_size    INT          NULL,
  data         LONGBLOB     NOT NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sst_order_photos_order (order_id),
  KEY idx_sst_order_photos_kind  (order_id, kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
