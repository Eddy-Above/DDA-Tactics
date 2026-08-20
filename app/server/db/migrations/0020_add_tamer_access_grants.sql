-- 0020_add_tamer_access_grants.sql
-- Replaces campaignAccessGrants' single-tamer/all-tamers player scope with a
-- proper many-to-many per-tamer access model, plus a per-tamer public-access
-- flag. A tamer is now reachable by DM-tier accounts (unchanged), an account
-- with a row in tamer_access_grants, or anyone if tamers.public_access is true.
-- public_access defaults TRUE for every tamer (existing and new) so nothing
-- currently working breaks — DMs opt individual tamers into restriction from
-- the campaign Settings page afterward.

-- Step 1: public-access flag on tamers, open by default.
ALTER TABLE tamers ADD COLUMN IF NOT EXISTS public_access BOOLEAN NOT NULL DEFAULT TRUE;

-- Step 2: new per-tamer grants table.
CREATE TABLE IF NOT EXISTS tamer_access_grants (
  id TEXT PRIMARY KEY,
  tamer_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- One grant row per (tamer, account); a tamer can have many accounts and an
-- account can be granted many tamers.
CREATE UNIQUE INDEX IF NOT EXISTS tamer_access_grants_tamer_user_idx
  ON tamer_access_grants (tamer_id, user_id);

-- Step 3: backfill existing "specific tamer" grants into the new table before
-- the old columns are dropped, so nobody's access is silently lost. Rows with
-- player_scope='all' have no single-tamer target and are simply dropped —
-- the broad "all tamers" scope option no longer exists.
INSERT INTO tamer_access_grants (id, tamer_id, user_id, created_at, updated_at)
SELECT gen_random_uuid()::text, player_tamer_id, user_id, created_at, updated_at
FROM campaign_access_grants
WHERE player_scope = 'specific' AND player_tamer_id IS NOT NULL
ON CONFLICT (tamer_id, user_id) DO NOTHING;

-- Step 4: campaign_access_grants becomes DM-role-only.
ALTER TABLE campaign_access_grants DROP COLUMN IF EXISTS player_scope;
ALTER TABLE campaign_access_grants DROP COLUMN IF EXISTS player_tamer_id;
