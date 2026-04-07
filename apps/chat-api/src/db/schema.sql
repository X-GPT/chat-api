-- Per-user file storage for sandbox daemon sync
CREATE TABLE IF NOT EXISTS user_files (
  user_id       TEXT NOT NULL,
  document_id   TEXT NOT NULL,
  type          INTEGER NOT NULL DEFAULT 0,
  slug          TEXT NOT NULL,
  path_key      TEXT NOT NULL,
  content       TEXT NOT NULL,
  checksum      TEXT NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, document_id)
);

-- Per-user sandbox runtime state
CREATE TABLE IF NOT EXISTS user_sandbox_runtime (
  user_id           TEXT PRIMARY KEY,
  sandbox_id        TEXT,
  agent_session_id  TEXT,
  state_version     BIGINT NOT NULL DEFAULT 0,
  synced_version    BIGINT NOT NULL DEFAULT 0,
  sandbox_status    TEXT NOT NULL DEFAULT 'idle',
  daemon_version    TEXT,
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger: auto-increment state_version on user_files changes
CREATE OR REPLACE FUNCTION bump_state_version()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_sandbox_runtime (user_id, state_version)
  VALUES (COALESCE(NEW.user_id, OLD.user_id), 1)
  ON CONFLICT (user_id) DO UPDATE
    SET state_version = user_sandbox_runtime.state_version + 1;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_files_state_version ON user_files;
CREATE TRIGGER user_files_state_version
  AFTER INSERT OR UPDATE OR DELETE ON user_files
  FOR EACH ROW EXECUTE FUNCTION bump_state_version();
