-- ============================================================================
-- SafeStorage Transport — MySQL tables for an EXISTING database
-- ----------------------------------------------------------------------------
-- This variant does NOT create or switch a database/schema. Run it against your
-- already-existing database — select it first, e.g.:
--
--   mysql -h <host> -u <user> -p <your_existing_db> < mysql/schema-existing-db.sql
--
-- (or open your DB in Workbench/phpMyAdmin and run this there).
--
-- It creates all tables + UUID/updated_at triggers and seeds the vendor master
-- and admin login. Safe to re-run: tables use IF NOT EXISTS, triggers are
-- dropped-then-recreated, seeds are idempotent.
--
-- Point the app at this database with MYSQL_DATABASE=<your_existing_db>.
-- ============================================================================

-- ─────────────────────────────── vendors ───────────────────────────────────
CREATE TABLE IF NOT EXISTS vendors (
  id                  CHAR(36)      NOT NULL,

  city                VARCHAR(120)  NOT NULL,
  name                VARCHAR(191)  NOT NULL,
  vehicle_type        VARCHAR(16)   NOT NULL,
  pallet_capacity     DECIMAL(4,1)  NOT NULL,
  effective_capacity  DECIMAL(4,1)  NOT NULL,

  tier                VARCHAR(16)   NOT NULL DEFAULT 'general',
  daily_price         DECIMAL(10,2) NULL,
  pricing_note        VARCHAR(255)  NULL,
  per_transaction     DECIMAL(10,2) NULL,

  starting_point      VARCHAR(191)  NULL,
  starting_lat        DOUBLE        NULL,
  starting_lng        DOUBLE        NULL,

  is_intercity_vendor TINYINT(1)    NOT NULL DEFAULT 0,

  system_team_id      VARCHAR(64)   NULL,
  system_team_no      VARCHAR(120)  NULL,
  vehicle_no          VARCHAR(64)   NULL,
  vehicle_name        VARCHAR(120)  NULL,
  driver_name         VARCHAR(120)  NULL,
  driver_contact      VARCHAR(40)   NULL,
  supervisor_name     VARCHAR(120)  NULL,
  supervisor_contact  VARCHAR(40)   NULL,
  packer_names        VARCHAR(255)  NULL,
  team_working_status VARCHAR(64)   NULL,

  security_deposit      DECIMAL(12,2) NULL,
  service_agreement_url TEXT          NULL,
  gst_document_url      TEXT          NULL,

  notes               TEXT          NULL,
  priority_group      VARCHAR(4)    NULL,
  supervisors         JSON          NULL,
  billing_cycle       VARCHAR(16)   NULL,

  remarks             VARCHAR(255)  NULL,
  active              TINYINT(1)    NOT NULL DEFAULT 1,
  source              VARCHAR(16)   NOT NULL DEFAULT 'panel',
  created_at          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_vendors_city_name_vt (city, name, vehicle_type),
  KEY idx_vendors_city (city),
  KEY idx_vendors_tier (tier),
  KEY idx_vendors_intercity (is_intercity_vendor),
  CONSTRAINT chk_vendors_vehicle_type CHECK (vehicle_type IN ('10ft','14ft','others')),
  CONSTRAINT chk_vendors_tier         CHECK (tier IN ('general','non_general'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────── settings ──────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  `key`      VARCHAR(120)  NOT NULL,
  value      DECIMAL(14,4) NOT NULL,
  updated_at TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────── transport_users ───────────────────────────────
CREATE TABLE IF NOT EXISTS transport_users (
  id            CHAR(36)     NOT NULL,
  email         VARCHAR(191) NOT NULL,
  password_hash TEXT         NOT NULL,
  name          VARCHAR(120) NOT NULL,
  role          VARCHAR(16)  NOT NULL DEFAULT 'staff',
  active        TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP    NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_transport_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ──────────────────────────────── orders ───────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id                 CHAR(36)      NOT NULL,
  schedule_date      DATE          NULL,
  city               VARCHAR(120)  NULL,
  order_id           VARCHAR(120)  NOT NULL,
  customer_unique_id VARCHAR(120)  NULL,
  customer_name      VARCHAR(191)  NULL,
  contact            VARCHAR(64)   NULL,
  order_type         VARCHAR(64)   NULL,
  is_intercity       TINYINT(1)    NULL,
  is_shifting        TINYINT(1)    NULL,
  pallets            DECIMAL(6,1)  NULL,
  stated_pallets     DECIMAL(6,1)  NULL,
  lift               VARCHAR(32)   NULL,
  transport_charge   DECIMAL(12,2) NULL,
  packing_charge     DECIMAL(12,2) NULL,
  locality           VARCHAR(255)  NULL,
  lat                DOUBLE        NULL,
  lng                DOUBLE        NULL,
  warehouse_name     VARCHAR(191)  NULL,
  warehouse_lat      DOUBLE        NULL,
  warehouse_lng      DOUBLE        NULL,
  time_slot          VARCHAR(64)   NULL,
  required_time      VARCHAR(64)   NULL,
  team_notes         TEXT          NULL,
  order_status       VARCHAR(64)   NULL,
  created_at         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_orders_order_id (order_id),
  KEY idx_orders_date_city (schedule_date, city)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ───────────────────────────── schedule_runs ───────────────────────────────
CREATE TABLE IF NOT EXISTS schedule_runs (
  id            CHAR(36)      NOT NULL,
  schedule_date DATE          NULL,
  city          VARCHAR(120)  NULL,
  `trigger`     VARCHAR(16)   NULL,
  status        VARCHAR(24)   NOT NULL DEFAULT 'draft',
  total_orders  INT           NULL,
  total_vendors INT           NULL,
  total_cost    DECIMAL(14,2) NULL,
  total_margin  DECIMAL(14,2) NULL,
  generated_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_runs_date_city (schedule_date, city)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────── schedule_assignments ───────────────────────────
CREATE TABLE IF NOT EXISTS schedule_assignments (
  id               CHAR(36)      NOT NULL,
  run_id           CHAR(36)      NOT NULL,
  vendor_id        CHAR(36)      NULL,
  vendor_name      VARCHAR(191)  NULL,
  order_id         CHAR(36)      NOT NULL,
  trip_no          INT           NOT NULL DEFAULT 0,
  stop_seq         INT           NOT NULL DEFAULT 0,
  resources        INT           NOT NULL DEFAULT 0,
  intercity_profit DECIMAL(12,2) NULL,
  created_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_assign_run (run_id),
  KEY idx_assign_order (order_id),
  CONSTRAINT fk_assign_run   FOREIGN KEY (run_id)   REFERENCES schedule_runs (id) ON DELETE CASCADE,
  CONSTRAINT fk_assign_order FOREIGN KEY (order_id) REFERENCES orders (id)        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────── schedule_vendor_addons ─────────────────────────
CREATE TABLE IF NOT EXISTS schedule_vendor_addons (
  run_id      CHAR(36)     NOT NULL,
  vendor_key  VARCHAR(191) NOT NULL,
  extra_trips INT          NOT NULL DEFAULT 0,
  resources   INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id, vendor_key),
  CONSTRAINT fk_addons_run FOREIGN KEY (run_id) REFERENCES schedule_runs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ───────────────────────────── schedule_changes ────────────────────────────
CREATE TABLE IF NOT EXISTS schedule_changes (
  id                 CHAR(36)     NOT NULL,
  order_id           VARCHAR(120) NULL,
  customer_unique_id VARCHAR(120) NULL,
  city               VARCHAR(120) NULL,
  service_date       DATE         NULL,
  event              VARCHAR(32)  NULL,
  order_type         VARCHAR(64)  NULL,
  is_intercity       TINYINT(1)   NULL,
  time_slot          VARCHAR(64)  NULL,
  order_status       VARCHAR(64)  NULL,
  source             VARCHAR(16)  NOT NULL DEFAULT 'webhook',
  payload            JSON         NULL,
  handled            TINYINT(1)   NOT NULL DEFAULT 0,
  received_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_changes_open (service_date, handled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ───────────────────────────── notifications ───────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id         CHAR(36)     NOT NULL,
  run_id     CHAR(36)     NULL,
  vendor_id  VARCHAR(120) NULL,
  order_id   VARCHAR(120) NULL,
  kind       VARCHAR(16)  NULL,
  channel    VARCHAR(24)  NOT NULL DEFAULT 'whatsapp',
  status     VARCHAR(24)  NULL,
  detail     TEXT         NULL,
  sent_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_notifications_run (run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────── UUID defaults (gen_random_uuid equivalent) ─────────────
-- Drop-then-create so the file is safe to re-run.
DROP TRIGGER IF EXISTS bi_vendors;
DROP TRIGGER IF EXISTS bi_transport_users;
DROP TRIGGER IF EXISTS bi_orders;
DROP TRIGGER IF EXISTS bi_schedule_runs;
DROP TRIGGER IF EXISTS bi_schedule_assignments;
DROP TRIGGER IF EXISTS bi_schedule_changes;
DROP TRIGGER IF EXISTS bi_notifications;

DELIMITER $$
CREATE TRIGGER bi_vendors              BEFORE INSERT ON vendors              FOR EACH ROW BEGIN IF NEW.id IS NULL OR NEW.id = '' THEN SET NEW.id = UUID(); END IF; END$$
CREATE TRIGGER bi_transport_users      BEFORE INSERT ON transport_users      FOR EACH ROW BEGIN IF NEW.id IS NULL OR NEW.id = '' THEN SET NEW.id = UUID(); END IF; END$$
CREATE TRIGGER bi_orders               BEFORE INSERT ON orders               FOR EACH ROW BEGIN IF NEW.id IS NULL OR NEW.id = '' THEN SET NEW.id = UUID(); END IF; END$$
CREATE TRIGGER bi_schedule_runs        BEFORE INSERT ON schedule_runs        FOR EACH ROW BEGIN IF NEW.id IS NULL OR NEW.id = '' THEN SET NEW.id = UUID(); END IF; END$$
CREATE TRIGGER bi_schedule_assignments BEFORE INSERT ON schedule_assignments FOR EACH ROW BEGIN IF NEW.id IS NULL OR NEW.id = '' THEN SET NEW.id = UUID(); END IF; END$$
CREATE TRIGGER bi_schedule_changes     BEFORE INSERT ON schedule_changes     FOR EACH ROW BEGIN IF NEW.id IS NULL OR NEW.id = '' THEN SET NEW.id = UUID(); END IF; END$$
CREATE TRIGGER bi_notifications        BEFORE INSERT ON notifications        FOR EACH ROW BEGIN IF NEW.id IS NULL OR NEW.id = '' THEN SET NEW.id = UUID(); END IF; END$$
DELIMITER ;

-- ============================================================================
-- SEED DATA (idempotent)
-- ============================================================================

INSERT IGNORE INTO settings (`key`, value) VALUES ('packing_per_pallet', 2000);

INSERT IGNORE INTO vendors
  (city, name, vehicle_type, pallet_capacity, effective_capacity, tier,
   starting_point, starting_lat, starting_lng, daily_price, pricing_note, per_transaction, is_intercity_vendor,
   system_team_id, system_team_no, vehicle_no, vehicle_name, driver_name, driver_contact,
   supervisor_name, supervisor_contact, packer_names, team_working_status, source)
VALUES
  ('Bangalore','VMS Packers Team 1','14ft',7,7.5,'general','Akshaya Nagar',12.897,77.633,7500,NULL,NULL,0,'158','VMS Packers Team','KA51AJ4776','VMS vehicle','Naveen vms','7676379728','Asif vms','9910484037',NULL,'Free','excel'),
  ('Bangalore','VMS Packers Team 2','14ft',7,7.5,'general','Akshaya Nagar',12.897,77.633,7500,NULL,NULL,0,'158','VMS Packers Team','KA51AJ4776','VMS vehicle','Naveen vms','7676379728','Asif vms','9910484037',NULL,'Free','excel'),
  ('Bangalore','Unnathi Packers','14ft',7,7.5,'general','Yeshwanthapur',13.028,77.54,7000,NULL,NULL,0,'161','Unnathi packers','KA27A7439','Unnati vehicle','Dayanand unnathi driver','9611570438','Sandeep','9611570438',NULL,'Free','excel'),
  ('Bangalore','Rainbow Packers','14ft',7,7.5,'general','Electronic City',12.845,77.66,7000,NULL,NULL,0,'127','BLR-Rainbow packers (Pankaj)','KA01D0258','Rainbow packers','Ajith','8757597451','Pankaj','8689083287','Anirul Ghazi','Free','excel'),
  ('Hyderabad','BRL Packers','14ft',7,7.5,'general','Chintal',17.508,78.452,7000,NULL,NULL,0,'174','BRL Packers (HYD)','TS08UJ8194','BRL Packers (HYD)','Vikas','9505655451','Anil','9050223525','Sahil, Smit','Free','excel'),
  ('Chennai','Kuberan Packers Team 1','14ft',7,7.5,'general','Ambattur',13.098,80.161,6200,NULL,NULL,0,'153','Kuberan Team 2','kuberan','Kuberan_drvier','kubera_driver','9789946011','Datchana','8610877228','Arpit','Free','excel'),
  ('Chennai','Kuberan Packers Team 2','14ft',7,7.5,'general','Gudapakkam',13.132,80.045,6200,NULL,NULL,0,'153','Kuberan Team 2','kuberan','Kuberan_drvier','kubera_driver','9789946011','Datchana','8610877228','Arpit','Free','excel'),
  ('Mumbai','BRL Packers','14ft',7,7.5,'general','Thane',19.218,72.978,7500,NULL,NULL,0,'207','BRL packers mum','KA 02 K 0050','BRL packers mum','BRL packers mumbai','9345234256','Pradeep','8800972698',NULL,'Free','excel'),
  ('Delhi','Rainbow Packers','14ft',7,7.5,'general','Dhanwapur',28.452,76.998,7000,NULL,NULL,0,'177','Delhi Jaykumar Rainbow team','rainbow vehicle','Delhi Vendor Rainbow team','Delhi Rainbow Driver','8088848484','Rajkumar','9899372676','Dilip proja','Free','excel'),
  ('Delhi','BRL Packers','14ft',7,7.5,'general','New Delhi',28.613,77.209,7000,NULL,NULL,0,'208','BRL packers delhi','ka 04 m 4697','brl packers delhi','BRL packers driver','8088848484','BRL packers delhi','9319546040',NULL,'Free','excel'),
  ('Bangalore','Chandan Packers','10ft',4,4.2,'general','Kasavanahalli',12.9,77.68,5000,NULL,NULL,0,'199','Chandan packers bangalore team','KA000','Chandan packers bangalore vehicle','Chandan Packers driver','8121345678','Chandan','9066519554',NULL,'Free','excel'),
  ('Bangalore','Rainbow Packers','10ft',4,4.2,'general','Electronic City',12.845,77.66,5000,NULL,NULL,0,'127','BLR-Rainbow packers (Pankaj)','KA01D0258','Rainbow packers','Ajith','8757597451','Pankaj','8689083287','Anirul Ghazi','Free','excel'),
  ('Bangalore','Unnathi Packers','10ft',4,4.2,'general','Yeshwanthapur',13.028,77.54,5000,NULL,NULL,0,'161','Unnathi packers','KA27A7439','Unnati vehicle','Dayanand unnathi driver','9611570438','Sandeep','9611570438',NULL,'Free','excel'),
  ('Bangalore','GSL Cargo Packers','10ft',4,4.2,'general','Rammurthy Nagar',13.018,77.677,5500,NULL,NULL,0,'188','GSL cargo packers','KA 02 K 0010','GSL packers','GSL cargo packers driver','9473768456','Kapil','9057731446',NULL,'Free','excel'),
  ('Hyderabad','Shree Shyam Packers','10ft',4,4.2,'general','Secunderabad',17.44,78.498,5000,NULL,NULL,0,'119','Shree shyam packers T1 (Arif Ali)','TS08UH9440','HYD_Eicher-E1','Maneesh Driver','8114780845','Arif Ali','7742632140','Panesh das, Rinku das','Free','excel'),
  ('Pune','BRL Packers','10ft',4,4.2,'general','Lonikand',18.602,73.989,4500,NULL,NULL,0,'176','BRL pune Mandeep','pune team','BRL Packers Pune (Mandeep)','Vendor Driver Pune BRL','8088848484','Mandeep','9728147180','Ayush','Free','excel'),
  ('Pune','SPM Packers','10ft',4,4.2,'general','Ngidi',18.651,73.77,6000,NULL,NULL,0,'184','SPM Team 1','SPM','SPM Drvier 1','SPM driver 1','8088848484','SPM Team1','9689433296','Nasim Akthar','Free','excel'),
  ('Mumbai','Sanjay Packers','10ft',4,4.2,'general','Chembur',19.062,72.9,5000,NULL,NULL,0,'203','Sanjay Packers','ka 04 m 4642','sanjay packers','Sanjay Packers driver','8980837464','Sanjay','7007924147',NULL,'Free','excel'),
  ('Bangalore','VMS Packers Team 3','others',7,7.5,'non_general','Akshaya Nagar',12.897,77.633,NULL,'6 transactions / ₹20,000',3333,0,'158','VMS Packers Team','KA51AJ4776','VMS vehicle','Naveen vms','7676379728','Asif vms','9910484037',NULL,'Free','excel'),
  ('Bangalore','Daksh Cargo Packers','others',7,7.5,'non_general','Kasavanahalli',12.9,77.68,NULL,'6 transactions / ₹15,000',2500,0,'183','Daksh packer Lakshman','Daksh','Daksh cargo packers','Daksh cargo packers','1233211231','Pappu Daksh cargo','9041634891','Sumir proja','Free','excel');

INSERT INTO vendors
  (city, name, vehicle_type, pallet_capacity, effective_capacity,
   tier, pricing_note, starting_point, starting_lat, starting_lng,
   is_intercity_vendor, supervisor_name, supervisor_contact, remarks, active, source)
VALUES
  ('Bangalore','BRL Packers','others',7,7.5,'non_general','Intercity — per-trip pricing (TBD)','Bangalore',12.9716,77.5946,1,'Sunil','9121606001','Intercity: all over India',1,'panel'),
  ('Bangalore','Best Express','others',7,7.5,'non_general','Intercity — per-trip pricing (TBD)','Bangalore',12.9716,77.5946,1,'Madhan','7973183628','Intercity: all over India',1,'panel'),
  ('Bangalore','Caravan Packers','others',7,7.5,'non_general','Intercity — per-trip pricing (TBD)','Bangalore',12.9716,77.5946,1,'Sandeep','9379005001','Intercity: all over India',1,'panel'),
  ('Bangalore','Daksh Packers','others',7,7.5,'non_general','Intercity — per-trip pricing (TBD)','Bangalore',12.9716,77.5946,1,'Ajay','9513133001','Intercity: from Bangalore, ~300–600 km',1,'panel'),
  ('Bangalore','Rainbow Packers','others',7,7.5,'non_general','Intercity — per-trip pricing (TBD)','Bangalore',12.9716,77.5946,1,'Rathan','9972526164','Intercity: from Bangalore, ~300–600 km',1,'panel')
ON DUPLICATE KEY UPDATE
  tier                = VALUES(tier),
  pricing_note        = VALUES(pricing_note),
  starting_point      = VALUES(starting_point),
  starting_lat        = VALUES(starting_lat),
  starting_lng        = VALUES(starting_lng),
  is_intercity_vendor = 1,
  supervisor_name     = VALUES(supervisor_name),
  supervisor_contact  = VALUES(supervisor_contact),
  remarks             = VALUES(remarks),
  active              = 1;

-- admin login — scrypt hash of "SafeStorage@2026" (change after first login)
INSERT INTO transport_users (email, name, role, active, password_hash)
VALUES (
  'admin@safestorage.in', 'Admin', 'admin', 1,
  'cea2d2c10c73a88903309db2743756e7:19ad43af6c25d05d25955f4420daded18f27bf312aaa6de38da8e6af68578442e0cb6efeb89de608968461b688da6331b086a1d614e588161480deec0e4bc4c6'
)
ON DUPLICATE KEY UPDATE
  password_hash = VALUES(password_hash),
  name          = VALUES(name),
  role          = VALUES(role),
  active        = 1;

-- Done. Set MYSQL_DATABASE to this database's name in the app env.
