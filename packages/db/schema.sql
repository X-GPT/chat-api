-- Daemon-owned tables. The authoritative document/collection/membership tables
-- (platform_knowledge, platform_collection, platform_knowledge_collection) are
-- managed by the upstream platform service and are not created here.

-- Shared trigger function that bumps updated_at on any UPDATE.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Per-user sandbox runtime state
CREATE TABLE IF NOT EXISTS user_sandbox_runtime (
  user_id      VARCHAR(255) NOT NULL PRIMARY KEY,
  sandbox_id   VARCHAR(255),
  last_seen_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Per-chat agent session IDs for conversation resume
CREATE TABLE IF NOT EXISTS user_sandbox_sessions (
  user_id    VARCHAR(255) NOT NULL,
  chat_key   VARCHAR(255) NOT NULL,
  session_id VARCHAR(255) NOT NULL,
  updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, chat_key)
);
DROP TRIGGER IF EXISTS user_sandbox_sessions_updated_at ON user_sandbox_sessions;
CREATE TRIGGER user_sandbox_sessions_updated_at
  BEFORE UPDATE ON user_sandbox_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
