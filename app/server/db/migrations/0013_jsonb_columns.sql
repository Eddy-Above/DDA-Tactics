-- 0013_jsonb_columns.sql
-- Converts the 34 JSON-ish TEXT columns across tamers, digimon, encounters,
-- campaigns, evolution_lines, and maps to native Postgres jsonb.
-- All existing values are valid JSON (verified by pre-migration audit), so a
-- direct ::jsonb cast is sufficient. Columns with string defaults get their
-- defaults dropped, the type changed, then re-added as jsonb defaults.

-- tamers
ALTER TABLE "tamers" ALTER COLUMN "attributes" TYPE jsonb USING "attributes"::jsonb;
ALTER TABLE "tamers" ALTER COLUMN "skills" TYPE jsonb USING "skills"::jsonb;
ALTER TABLE "tamers" ALTER COLUMN "aspects" TYPE jsonb USING "aspects"::jsonb;
ALTER TABLE "tamers" ALTER COLUMN "torments" TYPE jsonb USING "torments"::jsonb;
ALTER TABLE "tamers" ALTER COLUMN "special_orders" TYPE jsonb USING "special_orders"::jsonb;
ALTER TABLE "tamers" ALTER COLUMN "equipment" TYPE jsonb USING "equipment"::jsonb;

ALTER TABLE "tamers" ALTER COLUMN "xp_bonuses" DROP DEFAULT;
ALTER TABLE "tamers" ALTER COLUMN "xp_bonuses" TYPE jsonb USING "xp_bonuses"::jsonb;
ALTER TABLE "tamers" ALTER COLUMN "xp_bonuses" SET DEFAULT '{"attributes":{"agility":0,"body":0,"charisma":0,"intelligence":0,"willpower":0},"skills":{"dodge":0,"fight":0,"stealth":0,"athletics":0,"endurance":0,"featsOfStrength":0,"manipulate":0,"perform":0,"persuasion":0,"computer":0,"survival":0,"knowledge":0,"perception":0,"decipherIntent":0,"bravery":0},"inspiration":0}'::jsonb;

ALTER TABLE "tamers" ALTER COLUMN "used_per_day_orders" DROP DEFAULT;
ALTER TABLE "tamers" ALTER COLUMN "used_per_day_orders" TYPE jsonb USING "used_per_day_orders"::jsonb;
ALTER TABLE "tamers" ALTER COLUMN "used_per_day_orders" SET DEFAULT '[]'::jsonb;

ALTER TABLE "tamers" ALTER COLUMN "used_per_day_skill_orders" DROP DEFAULT;
ALTER TABLE "tamers" ALTER COLUMN "used_per_day_skill_orders" TYPE jsonb USING "used_per_day_skill_orders"::jsonb;
ALTER TABLE "tamers" ALTER COLUMN "used_per_day_skill_orders" SET DEFAULT '[]'::jsonb;

-- digimon
ALTER TABLE "digimon" ALTER COLUMN "base_stats" TYPE jsonb USING "base_stats"::jsonb;
ALTER TABLE "digimon" ALTER COLUMN "attacks" TYPE jsonb USING "attacks"::jsonb;
ALTER TABLE "digimon" ALTER COLUMN "qualities" TYPE jsonb USING "qualities"::jsonb;
ALTER TABLE "digimon" ALTER COLUMN "evolution_path_ids" TYPE jsonb USING "evolution_path_ids"::jsonb;
ALTER TABLE "digimon" ALTER COLUMN "gigantic_dimensions" TYPE jsonb USING "gigantic_dimensions"::jsonb;

ALTER TABLE "digimon" ALTER COLUMN "bonus_stats" DROP DEFAULT;
ALTER TABLE "digimon" ALTER COLUMN "bonus_stats" TYPE jsonb USING "bonus_stats"::jsonb;
ALTER TABLE "digimon" ALTER COLUMN "bonus_stats" SET DEFAULT '{"accuracy":0,"damage":0,"dodge":0,"armor":0,"health":0}'::jsonb;

-- encounters
ALTER TABLE "encounters" ALTER COLUMN "participants" TYPE jsonb USING "participants"::jsonb;
ALTER TABLE "encounters" ALTER COLUMN "turn_order" TYPE jsonb USING "turn_order"::jsonb;
ALTER TABLE "encounters" ALTER COLUMN "battle_log" TYPE jsonb USING "battle_log"::jsonb;
ALTER TABLE "encounters" ALTER COLUMN "hazards" TYPE jsonb USING "hazards"::jsonb;

ALTER TABLE "encounters" ALTER COLUMN "pending_requests" DROP DEFAULT;
ALTER TABLE "encounters" ALTER COLUMN "pending_requests" TYPE jsonb USING "pending_requests"::jsonb;
ALTER TABLE "encounters" ALTER COLUMN "pending_requests" SET DEFAULT '[]'::jsonb;

ALTER TABLE "encounters" ALTER COLUMN "request_responses" DROP DEFAULT;
ALTER TABLE "encounters" ALTER COLUMN "request_responses" TYPE jsonb USING "request_responses"::jsonb;
ALTER TABLE "encounters" ALTER COLUMN "request_responses" SET DEFAULT '[]'::jsonb;

ALTER TABLE "encounters" ALTER COLUMN "participant_positions" DROP DEFAULT;
ALTER TABLE "encounters" ALTER COLUMN "participant_positions" TYPE jsonb USING "participant_positions"::jsonb;
ALTER TABLE "encounters" ALTER COLUMN "participant_positions" SET DEFAULT '{}'::jsonb;

ALTER TABLE "encounters" ALTER COLUMN "destructible_states" DROP DEFAULT;
ALTER TABLE "encounters" ALTER COLUMN "destructible_states" TYPE jsonb USING "destructible_states"::jsonb;
ALTER TABLE "encounters" ALTER COLUMN "destructible_states" SET DEFAULT '[]'::jsonb;

-- campaigns
ALTER TABLE "campaigns" ALTER COLUMN "rules_settings" DROP DEFAULT;
ALTER TABLE "campaigns" ALTER COLUMN "rules_settings" TYPE jsonb USING "rules_settings"::jsonb;
ALTER TABLE "campaigns" ALTER COLUMN "rules_settings" SET DEFAULT '{}'::jsonb;

-- evolution_lines
ALTER TABLE "evolution_lines" ALTER COLUMN "chain" TYPE jsonb USING "chain"::jsonb;

-- maps
ALTER TABLE "maps" ALTER COLUMN "dimensions" DROP DEFAULT;
ALTER TABLE "maps" ALTER COLUMN "dimensions" TYPE jsonb USING "dimensions"::jsonb;

ALTER TABLE "maps" ALTER COLUMN "ground_tiles" DROP DEFAULT;
ALTER TABLE "maps" ALTER COLUMN "ground_tiles" TYPE jsonb USING "ground_tiles"::jsonb;
ALTER TABLE "maps" ALTER COLUMN "ground_tiles" SET DEFAULT '[]'::jsonb;

ALTER TABLE "maps" ALTER COLUMN "space_tiles" DROP DEFAULT;
ALTER TABLE "maps" ALTER COLUMN "space_tiles" TYPE jsonb USING "space_tiles"::jsonb;
ALTER TABLE "maps" ALTER COLUMN "space_tiles" SET DEFAULT '[]'::jsonb;

ALTER TABLE "maps" ALTER COLUMN "voxels" DROP DEFAULT;
ALTER TABLE "maps" ALTER COLUMN "voxels" TYPE jsonb USING "voxels"::jsonb;
ALTER TABLE "maps" ALTER COLUMN "voxels" SET DEFAULT '[]'::jsonb;

ALTER TABLE "maps" ALTER COLUMN "walls" DROP DEFAULT;
ALTER TABLE "maps" ALTER COLUMN "walls" TYPE jsonb USING "walls"::jsonb;
ALTER TABLE "maps" ALTER COLUMN "walls" SET DEFAULT '[]'::jsonb;

ALTER TABLE "maps" ALTER COLUMN "windows" DROP DEFAULT;
ALTER TABLE "maps" ALTER COLUMN "windows" TYPE jsonb USING "windows"::jsonb;
ALTER TABLE "maps" ALTER COLUMN "windows" SET DEFAULT '[]'::jsonb;

ALTER TABLE "maps" ALTER COLUMN "doors" DROP DEFAULT;
ALTER TABLE "maps" ALTER COLUMN "doors" TYPE jsonb USING "doors"::jsonb;
ALTER TABLE "maps" ALTER COLUMN "doors" SET DEFAULT '[]'::jsonb;

ALTER TABLE "maps" ALTER COLUMN "ceilings" DROP DEFAULT;
ALTER TABLE "maps" ALTER COLUMN "ceilings" TYPE jsonb USING "ceilings"::jsonb;
ALTER TABLE "maps" ALTER COLUMN "ceilings" SET DEFAULT '[]'::jsonb;

ALTER TABLE "maps" ALTER COLUMN "stairs" DROP DEFAULT;
ALTER TABLE "maps" ALTER COLUMN "stairs" TYPE jsonb USING "stairs"::jsonb;
ALTER TABLE "maps" ALTER COLUMN "stairs" SET DEFAULT '[]'::jsonb;
