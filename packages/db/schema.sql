-- Per-user file storage for sandbox daemon sync
CREATE TABLE IF NOT EXISTS user_files (
  user_id       VARCHAR(255) NOT NULL,
  document_id   VARCHAR(255) NOT NULL,
  type          INT NOT NULL DEFAULT 0,
  path_key      TEXT NOT NULL,
  content       MEDIUMTEXT NOT NULL,
  checksum      VARCHAR(255) NOT NULL,
  title         VARCHAR(500) DEFAULT NULL,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, document_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Per-user collection name lookup for _index.md generation
CREATE TABLE IF NOT EXISTS user_collections (
  user_id       VARCHAR(255) NOT NULL,
  collection_id VARCHAR(255) NOT NULL,
  name          VARCHAR(500) NOT NULL,
  PRIMARY KEY (user_id, collection_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Per-user sandbox runtime state
CREATE TABLE IF NOT EXISTS user_sandbox_runtime (
  user_id           VARCHAR(255) NOT NULL PRIMARY KEY,
  sandbox_id        VARCHAR(255),
  last_seen_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
