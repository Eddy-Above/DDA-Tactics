-- 0012_add_skill_orders.sql
-- Adds per-day skill order usage tracking to tamers.

ALTER TABLE tamers
  ADD COLUMN IF NOT EXISTS used_per_day_skill_orders TEXT NOT NULL DEFAULT '[]';
