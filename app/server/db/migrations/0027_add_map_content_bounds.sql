-- Display metadata only; existing maps populate it on their first in-app save.
-- Run manually before deploying; the legacy Drizzle journal omits manual migrations.
ALTER TABLE maps ADD COLUMN IF NOT EXISTS content_bounds jsonb;
