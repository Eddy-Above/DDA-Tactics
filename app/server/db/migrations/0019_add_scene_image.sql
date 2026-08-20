-- 0019_add_scene_image.sql
-- GM-set ambient scene image: a picture (+ optional caption) the GM shows to
-- everyone in the campaign for roleplay flavor, independent of the combat map.
-- Null in both columns is the correct "no scene set" state, so no backfill.

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS scene_image_url text;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS scene_image_caption text;
