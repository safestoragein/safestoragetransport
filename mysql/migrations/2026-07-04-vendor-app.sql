-- Vendor mobile app integration.
-- Lets transport vendors log into the Flutter app (phone + PIN), see their assignments,
-- push live job status, and stream their GPS location back to Today's schedule.
-- Run this once in phpMyAdmin (database: safestor_india).

-- 1) A PIN the vendor uses to log into the app. Admin sets/sees it in the Vendor panel and
--    shares it with the vendor (internal, sideloaded app — low-security by design).
ALTER TABLE sst_vendors
  ADD COLUMN app_pin VARCHAR(12) NULL AFTER does_local;

-- 2) Live, vendor-driven status on each order (fast read for the dashboard).
ALTER TABLE sst_orders
  ADD COLUMN live_status    VARCHAR(24) NULL AFTER order_status,   -- en_route/arrived/packing/loaded/delivered
  ADD COLUMN live_status_at TIMESTAMP   NULL AFTER live_status;

-- 3) Full audit trail of everything the vendor taps (with where they were when they tapped it).
CREATE TABLE IF NOT EXISTS sst_order_events (
  id         CHAR(36)     NOT NULL,
  order_id   CHAR(36)     NOT NULL,          -- -> sst_orders.id
  vendor_id  CHAR(36)     NULL,              -- -> sst_vendors.id
  event      VARCHAR(32)  NOT NULL,          -- en_route / arrived / packing / loaded / delivered / note
  lat        DOUBLE       NULL,
  lng        DOUBLE       NULL,
  note       TEXT         NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sst_order_events_order  (order_id),
  KEY idx_sst_order_events_vendor (vendor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4) Vendor GPS pings (latest row per vendor = current location; history for the trail).
CREATE TABLE IF NOT EXISTS sst_vendor_locations (
  vendor_id   CHAR(36)  NOT NULL,            -- -> sst_vendors.id
  lat         DOUBLE    NULL,
  lng         DOUBLE    NULL,
  accuracy    DOUBLE    NULL,
  recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sst_vendor_locations_vendor (vendor_id, recorded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
