-- Apply before deploying code that selects encounters.revision.
-- Row locks serialize UPDATEs even when callers started in the opposite order.
-- An updated_at value chosen before asynchronous work cannot provide this ordering.
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION bump_encounter_revision()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.revision := OLD.revision + 1;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS encounters_revision_before_update ON encounters;
--> statement-breakpoint
CREATE TRIGGER encounters_revision_before_update
BEFORE UPDATE ON encounters
FOR EACH ROW EXECUTE FUNCTION bump_encounter_revision();
