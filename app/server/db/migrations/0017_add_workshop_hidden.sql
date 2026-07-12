-- 0017_add_workshop_hidden.sql
-- Per-character Workshop visibility: owners can hide a sandbox character so
-- it only appears in the Workshop for them. Meaningful only for owned
-- sandbox records (campaign_id NULL + owner_id set) — the sandbox list
-- filter treats hidden-without-owner as visible, and campaign-scoped
-- queries ignore the flag entirely.

ALTER TABLE tamers ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE digimon ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE;
