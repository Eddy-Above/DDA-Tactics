-- 0010_map_system.sql
-- Adds the maps table and extends encounters + digimon for 3D isometric map support

CREATE TABLE IF NOT EXISTS maps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  campaign_id TEXT REFERENCES campaigns(id),
  dimensions TEXT NOT NULL DEFAULT '{"width":20,"depth":20,"height":10}',
  ground_tiles TEXT NOT NULL DEFAULT '[]',
  space_tiles TEXT NOT NULL DEFAULT '[]',
  walls TEXT NOT NULL DEFAULT '[]',
  windows TEXT NOT NULL DEFAULT '[]',
  doors TEXT NOT NULL DEFAULT '[]',
  ceilings TEXT NOT NULL DEFAULT '[]',
  stairs TEXT NOT NULL DEFAULT '[]',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE encounters
  ADD COLUMN IF NOT EXISTS map_id TEXT,
  ADD COLUMN IF NOT EXISTS participant_positions TEXT NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS destructible_states TEXT NOT NULL DEFAULT '[]';

ALTER TABLE digimon
  ADD COLUMN IF NOT EXISTS gigantic_dimensions TEXT;
