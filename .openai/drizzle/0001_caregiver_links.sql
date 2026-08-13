CREATE TABLE IF NOT EXISTS senior_devices (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '어르신',
  profile_json TEXT NOT NULL DEFAULT '{}',
  chat_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS link_codes (
  code_hash TEXT PRIMARY KEY,
  senior_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  FOREIGN KEY (senior_id) REFERENCES senior_devices(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS link_codes_senior_idx ON link_codes (senior_id, expires_at);

CREATE TABLE IF NOT EXISTS caregiver_seniors (
  caregiver_uid TEXT NOT NULL,
  senior_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  linked_at INTEGER NOT NULL,
  PRIMARY KEY (caregiver_uid, senior_id),
  FOREIGN KEY (senior_id) REFERENCES senior_devices(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS caregiver_seniors_owner_idx ON caregiver_seniors (caregiver_uid, linked_at DESC);

CREATE TABLE IF NOT EXISTS caregiver_threads (
  id TEXT PRIMARY KEY,
  caregiver_uid TEXT NOT NULL,
  senior_id TEXT,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (senior_id) REFERENCES senior_devices(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS caregiver_threads_owner_idx ON caregiver_threads (caregiver_uid, updated_at DESC);

CREATE TABLE IF NOT EXISTS caregiver_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  risk_level TEXT NOT NULL DEFAULT 'safe',
  warning_message TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES caregiver_threads(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS caregiver_messages_thread_idx ON caregiver_messages (thread_id, created_at);
