-- 0011_add_map_voxels.sql
-- Adds sparse voxel terrain/cover blocks to maps.

ALTER TABLE maps
  ADD COLUMN IF NOT EXISTS voxels TEXT NOT NULL DEFAULT '[]';
