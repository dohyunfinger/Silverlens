export const careSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS senior_devices (
    id TEXT PRIMARY KEY,
    secret_hash TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '어르신',
    profile_json TEXT NOT NULL DEFAULT '{}',
    chat_json TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS link_codes (
    code_hash TEXT PRIMARY KEY,
    senior_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    FOREIGN KEY (senior_id) REFERENCES senior_devices(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS link_codes_senior_idx
    ON link_codes (senior_id, expires_at)`,
  `CREATE TABLE IF NOT EXISTS caregiver_seniors (
    caregiver_uid TEXT NOT NULL,
    senior_id TEXT NOT NULL,
    alias TEXT NOT NULL,
    linked_at INTEGER NOT NULL,
    PRIMARY KEY (caregiver_uid, senior_id),
    FOREIGN KEY (senior_id) REFERENCES senior_devices(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS caregiver_seniors_owner_idx
    ON caregiver_seniors (caregiver_uid, linked_at DESC)`,
  `CREATE TABLE IF NOT EXISTS caregiver_threads (
    id TEXT PRIMARY KEY,
    caregiver_uid TEXT NOT NULL,
    senior_id TEXT,
    title TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (senior_id) REFERENCES senior_devices(id) ON DELETE SET NULL
  )`,
  `CREATE INDEX IF NOT EXISTS caregiver_threads_owner_idx
    ON caregiver_threads (caregiver_uid, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS caregiver_messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    risk_level TEXT NOT NULL DEFAULT 'safe',
    warning_message TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    FOREIGN KEY (thread_id) REFERENCES caregiver_threads(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS caregiver_messages_thread_idx
    ON caregiver_messages (thread_id, created_at)`,
] as const;

/** 식약처 낱알식별 OpenAPI를 검색 가능한 형태로 보관하는 D1 스키마. */
export const mfdsSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS mfds_pills (
    item_seq TEXT PRIMARY KEY,
    item_name TEXT NOT NULL,
    manufacturer TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    imprint_front TEXT NOT NULL DEFAULT '',
    imprint_back TEXT NOT NULL DEFAULT '',
    shape TEXT NOT NULL DEFAULT '',
    color_front TEXT NOT NULL DEFAULT '',
    color_back TEXT NOT NULL DEFAULT '',
    score_line_front TEXT NOT NULL DEFAULT '',
    score_line_back TEXT NOT NULL DEFAULT '',
    length_long TEXT NOT NULL DEFAULT '',
    length_short TEXT NOT NULL DEFAULT '',
    thickness TEXT NOT NULL DEFAULT '',
    class_name TEXT NOT NULL DEFAULT '',
    otc_type TEXT NOT NULL DEFAULT '',
    dosage_form TEXT NOT NULL DEFAULT '',
    english_name TEXT NOT NULL DEFAULT '',
    standard_code TEXT NOT NULL DEFAULT '',
    item_name_search TEXT NOT NULL DEFAULT '',
    manufacturer_search TEXT NOT NULL DEFAULT '',
    imprint_front_search TEXT NOT NULL DEFAULT '',
    imprint_back_search TEXT NOT NULL DEFAULT '',
    sync_generation TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS mfds_pills_item_name_idx
    ON mfds_pills (item_name_search)`,
  `CREATE INDEX IF NOT EXISTS mfds_pills_imprint_front_idx
    ON mfds_pills (imprint_front_search)`,
  `CREATE INDEX IF NOT EXISTS mfds_pills_imprint_back_idx
    ON mfds_pills (imprint_back_search)`,
  `CREATE TABLE IF NOT EXISTS mfds_sync_state (
    id TEXT PRIMARY KEY CHECK (id = 'catalog'),
    generation TEXT NOT NULL DEFAULT '',
    next_page INTEGER NOT NULL DEFAULT 1,
    total_pages INTEGER NOT NULL DEFAULT 0,
    total_count INTEGER NOT NULL DEFAULT 0,
    records_synced INTEGER NOT NULL DEFAULT 0,
    last_started_at INTEGER,
    last_success_at INTEGER,
    last_error TEXT NOT NULL DEFAULT '',
    locked_until INTEGER NOT NULL DEFAULT 0
  )`,
  `INSERT OR IGNORE INTO mfds_sync_state (id) VALUES ('catalog')`,
] as const;
