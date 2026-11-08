-- Apply before deploying code that selects tamers.total_xp.
-- Prior Inspiration consumption erased purchase history; do not invent legacy totals.
ALTER TABLE tamers ADD COLUMN IF NOT EXISTS total_xp INTEGER;
