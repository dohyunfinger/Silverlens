CREATE TABLE IF NOT EXISTS mfds_pills (
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
);

CREATE INDEX IF NOT EXISTS mfds_pills_item_name_idx
  ON mfds_pills (item_name_search);
CREATE INDEX IF NOT EXISTS mfds_pills_imprint_front_idx
  ON mfds_pills (imprint_front_search);
CREATE INDEX IF NOT EXISTS mfds_pills_imprint_back_idx
  ON mfds_pills (imprint_back_search);

CREATE TABLE IF NOT EXISTS mfds_sync_state (
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
);

INSERT OR IGNORE INTO mfds_sync_state (id) VALUES ('catalog');
