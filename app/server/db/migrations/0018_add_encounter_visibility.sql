-- 0018_add_encounter_visibility.sql
-- GM-controlled encounter visibility. Players see nothing of an encounter (no
-- participants, no pending requests, no prompts) until the GM makes it visible.
-- This is what lets a GM stage several encounters in parallel without the player
-- page latching onto a half-built one.
--
-- New encounters start hidden; encounters already in play are backfilled to
-- visible so this migration doesn't blank out a live session.

ALTER TABLE encounters ADD COLUMN IF NOT EXISTS visible_to_players BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE encounters SET visible_to_players = TRUE WHERE phase IN ('setup', 'initiative', 'combat');
