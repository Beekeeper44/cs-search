-- CS Search completed-work log.
-- The API creates this automatically on first call; run it by hand if you
-- prefer the table to exist before the first deploy.

CREATE TABLE IF NOT EXISTS cs_search_history (
  id                     BIGSERIAL PRIMARY KEY,
  completed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  team_member            TEXT NOT NULL,
  outcome                TEXT NOT NULL,
  note                   TEXT,
  scanned_input          TEXT,
  order_number           TEXT,
  order_kind             TEXT,
  order_source           TEXT,
  order_detail           TEXT,
  order_created_at       TEXT,
  order_processed_at     TEXT,
  po_numbers             TEXT,
  customer_name          TEXT,
  username               TEXT,
  user_email             TEXT,
  cards_in_shipment      INTEGER,
  ship_date              TEXT,
  card_status            TEXT,
  ac_number              TEXT,
  cert_number            TEXT,
  player_name            TEXT,
  set_name               TEXT,
  insert_name            TEXT,
  parallel_name          TEXT,
  parallel_total         TEXT,
  sport                  TEXT,
  grade                  TEXT,
  front_slab_picture_url TEXT
);

CREATE INDEX IF NOT EXISTS cs_search_history_completed_idx ON cs_search_history (completed_at DESC);
CREATE INDEX IF NOT EXISTS cs_search_history_member_idx    ON cs_search_history (team_member);
CREATE INDEX IF NOT EXISTS cs_search_history_cert_idx      ON cs_search_history (cert_number);
CREATE INDEX IF NOT EXISTS cs_search_history_ac_idx        ON cs_search_history (ac_number);
