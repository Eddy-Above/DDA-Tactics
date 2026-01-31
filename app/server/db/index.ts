import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'
import * as schema from './schema'

// Get database path from runtime config or use default
const dbPath = process.env.NUXT_DB_PATH || './data/digimon.db'

// Ensure the directory exists
const dbDir = dirname(dbPath)
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true })
}

// Create SQLite connection
const sqlite = new Database(dbPath)

// Enable WAL mode for better concurrent performance
sqlite.pragma('journal_mode = WAL')

// Create tables if they don't exist
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS tamers (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    age INTEGER NOT NULL,
    campaign_level TEXT NOT NULL,
    attributes TEXT NOT NULL,
    skills TEXT NOT NULL,
    aspects TEXT NOT NULL,
    torments TEXT NOT NULL,
    special_orders TEXT NOT NULL,
    inspiration INTEGER NOT NULL DEFAULT 1,
    xp INTEGER NOT NULL DEFAULT 0,
    equipment TEXT NOT NULL,
    current_wounds INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS digimon (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    species TEXT NOT NULL,
    stage TEXT NOT NULL,
    attribute TEXT NOT NULL,
    family TEXT NOT NULL,
    type TEXT,
    size TEXT NOT NULL DEFAULT 'medium',
    base_stats TEXT NOT NULL,
    attacks TEXT NOT NULL,
    qualities TEXT NOT NULL,
    data_optimization TEXT,
    base_dp INTEGER NOT NULL,
    bonus_dp INTEGER NOT NULL DEFAULT 0,
    bonus_stats TEXT NOT NULL DEFAULT '{"accuracy":0,"damage":0,"dodge":0,"armor":0,"health":0}',
    bonus_dp_for_qualities INTEGER NOT NULL DEFAULT 0,
    current_wounds INTEGER NOT NULL DEFAULT 0,
    current_stance TEXT NOT NULL DEFAULT 'neutral',
    evolution_path_ids TEXT NOT NULL,
    evolves_from_id TEXT,
    partner_id TEXT REFERENCES tamers(id),
    is_enemy INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    sprite_url TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS encounters (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    round INTEGER NOT NULL DEFAULT 0,
    phase TEXT NOT NULL DEFAULT 'setup',
    participants TEXT NOT NULL,
    turn_order TEXT NOT NULL,
    current_turn_index INTEGER NOT NULL DEFAULT 0,
    battle_log TEXT NOT NULL,
    hazards TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    level TEXT NOT NULL DEFAULT 'standard',
    tamer_ids TEXT NOT NULL,
    encounter_ids TEXT NOT NULL,
    current_encounter_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS evolution_lines (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    chain TEXT NOT NULL,
    partner_id TEXT REFERENCES tamers(id),
    current_stage_index INTEGER NOT NULL DEFAULT 0,
    evolution_progress TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`)

// Create Drizzle instance with schema
export const db = drizzle(sqlite, { schema })

// Export schema for use in other files
export * from './schema'
