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
