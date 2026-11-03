-- 0021_add_intercede_opt_outs.sql
-- "Never intercede" opt-outs get their own column. They used to live on the participant
-- rows inside `participants`, which nearly every combat endpoint rewrites wholesale from a
-- copy read at request start — so a concurrent write (two players answering the same
-- prompt, the GM attacking while a player opts out) silently put the old list back.
-- Only the opt-out endpoints write this column.
--
-- Shape: { targets?: { [tamerEntityId | 'GM']: targetParticipantId[] },
--          gmCharacters?: { [targetParticipantId]: interceptorParticipantId[] } }
--
-- No backfill: encounters already in play keep reading the old participant-level lists
-- until their owner saves again (see app/utils/intercedeOptOuts.ts).

ALTER TABLE encounters ADD COLUMN IF NOT EXISTS intercede_opt_outs JSONB NOT NULL DEFAULT '{}'::jsonb;
