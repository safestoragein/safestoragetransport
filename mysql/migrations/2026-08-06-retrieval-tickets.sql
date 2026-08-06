-- ============================================================================================
-- RETRIEVAL module — email-driven ticketing.
--
-- Two mailboxes (retrieval@ and damages@) are polled hourly; every message becomes a ticket or
-- joins an existing thread. Priority rises with the number of times the CUSTOMER writes in
-- (1st mail = P4 … 4th+ = P1), unless the team pins it by hand. Tickets are later pushed to the
-- external ticket API and the returned id is kept here so the two systems stay linked.
--
-- Safe to run more than once. Run against `safestor_india` on the AWS server.
-- ============================================================================================

-- 1) TICKETS -----------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sst_ret_tickets (
  id                 CHAR(36)     NOT NULL PRIMARY KEY,
  ticket_no          VARCHAR(24)  NOT NULL,             -- human ref, e.g. RET-000142 / DMG-000073
  mailbox            VARCHAR(32)  NOT NULL,             -- 'retrieval' | 'damages' (which box it arrived in)
  category           VARCHAR(24)  NOT NULL DEFAULT 'retrieval', -- retrieval | damage | other (editable)

  -- email threading
  subject            VARCHAR(500) NULL,
  root_message_id    VARCHAR(500) NULL,                 -- Message-ID of the first mail in the thread
  thread_key         VARCHAR(255) NULL,                 -- sender + normalised subject; catches customers
                                                        -- who send a NEW mail instead of replying
  from_email         VARCHAR(191) NULL,
  from_name          VARCHAR(191) NULL,

  -- who the customer is (resolved from the live feed by booking code or sender address)
  customer_id        VARCHAR(32)  NULL,                 -- WMS NUMERIC id — the reliable join key
  customer_unique_id VARCHAR(32)  NULL,                 -- BH26174 (display; can repeat)
  customer_name      VARCHAR(191) NULL,
  contact            VARCHAR(64)  NULL,
  city               VARCHAR(64)  NULL,
  order_id           VARCHAR(32)  NULL,                 -- WMS order id when we can match one

  -- workflow
  status             VARCHAR(24)  NOT NULL DEFAULT 'new',  -- new | in_progress | waiting_customer | resolved | closed
  priority           VARCHAR(4)   NOT NULL DEFAULT 'P4',   -- P1 (highest) … P4
  priority_locked    TINYINT(1)   NOT NULL DEFAULT 0,      -- 1 = team set it by hand; auto-bump stops
  customer_msg_count INT          NOT NULL DEFAULT 0,      -- inbound mails from the customer → drives priority
  assigned_to        VARCHAR(120) NULL,

  -- SLA / follow-up (same language as the Escalations page)
  first_response_at  TIMESTAMP    NULL,                 -- when we first replied
  last_customer_at   TIMESTAMP    NULL,                 -- newest inbound mail
  last_agent_at      TIMESTAMP    NULL,                 -- newest outbound mail
  followup_date      DATE         NULL,
  followup_notes     TEXT         NULL,
  resolution_notes   TEXT         NULL,
  resolved_at        TIMESTAMP    NULL,

  -- link to the external ticket system (pushed after the ticket API is available)
  external_ticket_id VARCHAR(64)  NULL,
  external_synced_at TIMESTAMP    NULL,
  external_error     TEXT         NULL,

  created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_sst_ret_ticket_no (ticket_no),
  KEY idx_sst_ret_thread (thread_key),
  KEY idx_sst_ret_root_msg (root_message_id),
  KEY idx_sst_ret_status (status),
  KEY idx_sst_ret_priority (priority),
  KEY idx_sst_ret_customer (customer_id),
  KEY idx_sst_ret_booking (customer_unique_id),
  KEY idx_sst_ret_created (created_at),
  KEY idx_sst_ret_mailbox (mailbox)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2) MESSAGES — every mail in the thread, inbound and outbound -----------------------------------
CREATE TABLE IF NOT EXISTS sst_ret_ticket_messages (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  ticket_id     CHAR(36)     NOT NULL,
  direction     VARCHAR(10)  NOT NULL DEFAULT 'inbound', -- inbound (customer) | outbound (us)
  mailbox       VARCHAR(32)  NULL,

  message_id    VARCHAR(500) NOT NULL,                   -- RFC Message-ID — dedupes re-reads of the box
  in_reply_to   VARCHAR(500) NULL,
  references_hdr TEXT        NULL,
  remote_id     VARCHAR(255) NULL,                       -- provider id (Graph message id / IMAP UID)

  from_email    VARCHAR(191) NULL,
  from_name     VARCHAR(191) NULL,
  to_emails     TEXT         NULL,
  cc_emails     TEXT         NULL,
  subject       VARCHAR(500) NULL,
  body_text     MEDIUMTEXT   NULL,
  body_html     MEDIUMTEXT   NULL,
  snippet       VARCHAR(500) NULL,                       -- first ~300 chars, for the list view
  is_auto_reply TINYINT(1)   NOT NULL DEFAULT 0,         -- out-of-office / bounce → never bumps priority
  has_attach    TINYINT(1)   NOT NULL DEFAULT 0,

  sent_at       TIMESTAMP    NULL,                       -- the mail's own date header
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_sst_ret_msg_id (message_id),
  KEY idx_sst_ret_msg_ticket (ticket_id),
  KEY idx_sst_ret_msg_sent (sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3) ATTACHMENTS — kept in the DB like vendor documents/photos ----------------------------------
CREATE TABLE IF NOT EXISTS sst_ret_ticket_attachments (
  id           CHAR(36)     NOT NULL PRIMARY KEY,
  ticket_id    CHAR(36)     NOT NULL,
  message_id   CHAR(36)     NOT NULL,                    -- sst_ret_ticket_messages.id
  filename     VARCHAR(255) NULL,
  content_type VARCHAR(128) NULL,
  byte_size    INT          NULL,
  data         LONGBLOB     NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sst_ret_att_ticket (ticket_id),
  KEY idx_sst_ret_att_msg (message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4) SYNC CURSOR — one row per mailbox, so an hourly run only reads what is new -----------------
CREATE TABLE IF NOT EXISTS sst_ret_mail_sync (
  mailbox         VARCHAR(32)  NOT NULL PRIMARY KEY,     -- 'retrieval' | 'damages'
  address         VARCHAR(191) NULL,
  last_remote_id  VARCHAR(255) NULL,                     -- last Graph message id / IMAP UID processed
  last_message_at TIMESTAMP    NULL,                     -- newest mail date ingested (the real cursor)
  last_synced_at  TIMESTAMP    NULL,
  last_status     VARCHAR(24)  NULL,                     -- ok | error
  last_error      TEXT         NULL,
  messages_seen   INT          NOT NULL DEFAULT 0,
  tickets_created INT          NOT NULL DEFAULT 0,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed the two mailboxes; the first run reads only the LAST 7 DAYS so we don't ingest history.
INSERT IGNORE INTO sst_ret_mail_sync (mailbox, address, last_message_at)
VALUES
  ('retrieval', 'retrieval@safestorage.in', DATE_SUB(NOW(), INTERVAL 7 DAY)),
  ('damages',   'damages@safestorage.in',   DATE_SUB(NOW(), INTERVAL 7 DAY));

-- 5) AUDIT TRAIL — who changed what, and every automatic priority bump ---------------------------
CREATE TABLE IF NOT EXISTS sst_ret_ticket_events (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  ticket_id  CHAR(36)     NOT NULL,
  kind       VARCHAR(32)  NOT NULL,                      -- status | priority | assign | note | external_sync | mail_in | mail_out
  from_value VARCHAR(191) NULL,
  to_value   VARCHAR(191) NULL,
  actor      VARCHAR(120) NULL,                          -- transport user, or 'system' for auto bumps
  note       TEXT         NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sst_ret_ev_ticket (ticket_id),
  KEY idx_sst_ret_ev_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6) TICKET NUMBER COUNTER — one row per prefix, incremented atomically by the app ---------------
CREATE TABLE IF NOT EXISTS sst_ret_ticket_seq (
  prefix  VARCHAR(8) NOT NULL PRIMARY KEY,               -- 'RET' | 'DMG'
  last_no INT        NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO sst_ret_ticket_seq (prefix, last_no) VALUES ('RET', 0), ('DMG', 0);
