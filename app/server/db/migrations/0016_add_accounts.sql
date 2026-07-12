-- 0016_add_accounts.sql
-- Optional user accounts: username+password login (no email/personal data),
-- server-side sessions (httpOnly cookie, unlike the existing boolean-flag
-- campaign cookies), and per-campaign account access grants that let a
-- campaign owner give a specific account standing access without a password.
-- owner_id on campaigns is stamped at creation time only (if the creator was
-- logged in) and is never reassigned later. tamers.owner_id/digimon.owner_id
-- already exist (migration 0015) and are wired up by application code only —
-- no schema change needed for them here.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Case-insensitive uniqueness enforced at the DB level (not just app-level)
-- to avoid a race between two concurrent registrations of the same name.
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (LOWER(username));

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,  -- the id itself is the opaque session token used as the cookie value
  user_id TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);

CREATE TABLE IF NOT EXISTS campaign_access_grants (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  dm_role TEXT,          -- 'co-dm' | 'co-owner' | NULL
  player_scope TEXT,     -- 'all' | 'specific' | NULL
  player_tamer_id TEXT,  -- set only when player_scope = 'specific'
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- One grant row per (campaign, account); a single account can hold a DM role
-- and a player scope at the same time.
CREATE UNIQUE INDEX IF NOT EXISTS campaign_access_grants_campaign_user_idx
  ON campaign_access_grants (campaign_id, user_id);

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS owner_id TEXT;
