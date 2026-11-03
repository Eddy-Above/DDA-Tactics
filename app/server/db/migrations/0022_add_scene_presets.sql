-- 0022_add_scene_presets.sql
-- GM-prepared scene tabs for the Scene editor: up to 10 scenes the GM sets up
-- ahead of time, then shows (and steps through with the GM-only arrows) during play.
--
-- Shape: [{ imageUrl: string, caption: string }]  (max 10, empty strings = empty tab)
--
-- GM prep data only: never broadcast to the campaign room (players are in it), so
-- upcoming scenes aren't spoiled. Only the live scene (scene_image_url/caption) is shown.

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS scene_presets JSONB NOT NULL DEFAULT '[]'::jsonb;
