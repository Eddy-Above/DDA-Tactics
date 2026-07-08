-- 0014_add_roll_log.sql
-- Adds the roll_log table: a campaign-wide, append-only history of player
-- skill/attribute/torment rolls plus "new day" markers, capped to the newest
-- 50 rows per campaign by the application layer (server/utils/rollLog.ts).

CREATE TABLE IF NOT EXISTS roll_log (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  kind TEXT NOT NULL,

  tamer_id TEXT,
  character_name TEXT,
  sprite_url TEXT,
  roll_name TEXT,

  rolls jsonb NOT NULL DEFAULT '[]'::jsonb,
  modifier INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  passed BOOLEAN,

  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS roll_log_campaign_created_idx
  ON roll_log (campaign_id, created_at);
