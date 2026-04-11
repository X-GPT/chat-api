-- Per-user file storage for sandbox daemon sync
CREATE TABLE IF NOT EXISTS user_files (
  user_id       VARCHAR(255) NOT NULL,
  document_id   VARCHAR(255) NOT NULL,
  type          INT NOT NULL DEFAULT 0,
  slug          TEXT NOT NULL,
  path_key      TEXT NOT NULL,
  content       MEDIUMTEXT NOT NULL,
  checksum      VARCHAR(255) NOT NULL,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, document_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Per-user sandbox runtime state
CREATE TABLE IF NOT EXISTS user_sandbox_runtime (
  user_id           VARCHAR(255) NOT NULL PRIMARY KEY,
  sandbox_id        VARCHAR(255),
  state_version     BIGINT NOT NULL DEFAULT 0,
  last_seen_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Per-chat agent session IDs for conversation resume
CREATE TABLE IF NOT EXISTS user_sandbox_sessions (
  user_id    VARCHAR(255) NOT NULL,
  chat_key   VARCHAR(255) NOT NULL,
  session_id VARCHAR(255) NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, chat_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Triggers: auto-increment state_version on user_files changes
DELIMITER //

DROP TRIGGER IF EXISTS user_files_after_insert //
DROP TRIGGER IF EXISTS user_files_after_update //
DROP TRIGGER IF EXISTS user_files_after_delete //

CREATE TRIGGER user_files_after_insert
AFTER INSERT ON user_files
FOR EACH ROW
BEGIN
  INSERT INTO user_sandbox_runtime (user_id, state_version)
  VALUES (NEW.user_id, 1)
  ON DUPLICATE KEY UPDATE state_version = state_version + 1;
END //

CREATE TRIGGER user_files_after_update
AFTER UPDATE ON user_files
FOR EACH ROW
BEGIN
  INSERT INTO user_sandbox_runtime (user_id, state_version)
  VALUES (NEW.user_id, 1)
  ON DUPLICATE KEY UPDATE state_version = state_version + 1;
END //

CREATE TRIGGER user_files_after_delete
AFTER DELETE ON user_files
FOR EACH ROW
BEGIN
  INSERT INTO user_sandbox_runtime (user_id, state_version)
  VALUES (OLD.user_id, 1)
  ON DUPLICATE KEY UPDATE state_version = state_version + 1;
END //

DELIMITER ;
