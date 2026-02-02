-- Migration to properly convert TEXT JSON columns to JSONB
-- The previous automatic conversion failed because the data is corrupted strings

-- For participants column: try to parse as JSON, fallback to empty array
ALTER TABLE "encounters"
  ADD COLUMN "participants_new" jsonb;

UPDATE "encounters"
SET "participants_new" = CASE
  WHEN "participants" IS NULL THEN '[]'::jsonb
  WHEN "participants" = '' THEN '[]'::jsonb
  WHEN "participants" = '[]' THEN '[]'::jsonb
  WHEN "participants"::text LIKE '[%' THEN "participants"::jsonb
  ELSE '[]'::jsonb
END;

ALTER TABLE "encounters" DROP COLUMN "participants";
ALTER TABLE "encounters" RENAME COLUMN "participants_new" TO "participants";

-- For turn_order column: handle string data
ALTER TABLE "encounters"
  ADD COLUMN "turn_order_new" jsonb;

UPDATE "encounters"
SET "turn_order_new" = CASE
  WHEN "turn_order" IS NULL THEN '[]'::jsonb
  WHEN "turn_order" = '' THEN '[]'::jsonb
  WHEN "turn_order" = '[]' THEN '[]'::jsonb
  WHEN "turn_order"::text LIKE '[%' THEN "turn_order"::jsonb
  -- Handle single string values (wrap in array)
  ELSE jsonb_build_array("turn_order"::text)
END;

ALTER TABLE "encounters" DROP COLUMN "turn_order";
ALTER TABLE "encounters" RENAME COLUMN "turn_order_new" TO "turn_order";

-- For battle_log column
ALTER TABLE "encounters"
  ADD COLUMN "battle_log_new" jsonb;

UPDATE "encounters"
SET "battle_log_new" = CASE
  WHEN "battle_log" IS NULL THEN '[]'::jsonb
  WHEN "battle_log" = '' THEN '[]'::jsonb
  WHEN "battle_log" = '[]' THEN '[]'::jsonb
  WHEN "battle_log"::text LIKE '[%' THEN "battle_log"::jsonb
  ELSE '[]'::jsonb
END;

ALTER TABLE "encounters" DROP COLUMN "battle_log";
ALTER TABLE "encounters" RENAME COLUMN "battle_log_new" TO "battle_log";

-- For hazards column
ALTER TABLE "encounters"
  ADD COLUMN "hazards_new" jsonb;

UPDATE "encounters"
SET "hazards_new" = CASE
  WHEN "hazards" IS NULL THEN '[]'::jsonb
  WHEN "hazards" = '' THEN '[]'::jsonb
  WHEN "hazards" = '[]' THEN '[]'::jsonb
  WHEN "hazards"::text LIKE '[%' THEN "hazards"::jsonb
  ELSE '[]'::jsonb
END;

ALTER TABLE "encounters" DROP COLUMN "hazards";
ALTER TABLE "encounters" RENAME COLUMN "hazards_new" TO "hazards";
