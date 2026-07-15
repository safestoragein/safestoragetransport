-- Admin-tool usage tracking: one row per login / logout / minute-heartbeat per signed-in user.
-- Powers the admin-only "Team usage" insights (sessions, active time, idle gaps, per-view time).
-- Safe to run more than once.
CREATE TABLE IF NOT EXISTS sst_user_activity (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(100) NOT NULL,
  email VARCHAR(255) NULL,
  name VARCHAR(255) NULL,
  event VARCHAR(20) NOT NULL,          -- login | beat | logout
  view VARCHAR(50) NULL,               -- which page the beat came from
  ip VARCHAR(64) NULL,
  at DATETIME NOT NULL,                -- IST
  KEY idx_at (at),
  KEY idx_user_at (user_id, at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
