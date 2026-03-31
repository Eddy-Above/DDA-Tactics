-- Add campaign_id to all entity tables
ALTER TABLE "tamers" ADD COLUMN "campaign_id" text;--> statement-breakpoint
ALTER TABLE "digimon" ADD COLUMN "campaign_id" text;--> statement-breakpoint
ALTER TABLE "encounters" ADD COLUMN "campaign_id" text;--> statement-breakpoint
ALTER TABLE "evolution_lines" ADD COLUMN "campaign_id" text;--> statement-breakpoint

-- Add password and rules columns to campaigns
ALTER TABLE "campaigns" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "dm_password_hash" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "rules_settings" text NOT NULL DEFAULT '{}';--> statement-breakpoint

-- Drop old columns from campaigns
ALTER TABLE "campaigns" DROP COLUMN IF EXISTS "tamer_ids";--> statement-breakpoint
ALTER TABLE "campaigns" DROP COLUMN IF EXISTS "encounter_ids";--> statement-breakpoint
ALTER TABLE "campaigns" DROP COLUMN IF EXISTS "current_encounter_id";--> statement-breakpoint

-- Drop campaign_level from tamers (now campaign-wide)
ALTER TABLE "tamers" DROP COLUMN IF EXISTS "campaign_level";--> statement-breakpoint

-- Add foreign key constraints
DO $$ BEGIN
 ALTER TABLE "tamers" ADD CONSTRAINT "tamers_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "digimon" ADD CONSTRAINT "digimon_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "encounters" ADD CONSTRAINT "encounters_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "evolution_lines" ADD CONSTRAINT "evolution_lines_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- Auto-migrate: Create a default campaign and assign all existing entities to it
DO $$
DECLARE
  default_campaign_id text := 'default-campaign-' || gen_random_uuid()::text;
  first_level text;
BEGIN
  -- Check if there are any existing entities to migrate
  IF EXISTS (SELECT 1 FROM tamers LIMIT 1) OR EXISTS (SELECT 1 FROM digimon LIMIT 1) OR EXISTS (SELECT 1 FROM encounters LIMIT 1) OR EXISTS (SELECT 1 FROM evolution_lines LIMIT 1) THEN
    -- Try to get campaign level from first tamer, default to 'standard'
    SELECT 'standard' INTO first_level;

    -- Create default campaign
    INSERT INTO campaigns (id, name, description, level, rules_settings)
    VALUES (default_campaign_id, 'Default Campaign', 'Auto-migrated campaign', first_level, '{}');

    -- Assign all orphaned entities to the default campaign
    UPDATE tamers SET campaign_id = default_campaign_id WHERE campaign_id IS NULL;
    UPDATE digimon SET campaign_id = default_campaign_id WHERE campaign_id IS NULL;
    UPDATE encounters SET campaign_id = default_campaign_id WHERE campaign_id IS NULL;
    UPDATE evolution_lines SET campaign_id = default_campaign_id WHERE campaign_id IS NULL;
  END IF;
END $$;
