ALTER TABLE "encounters" ALTER COLUMN "participants" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "encounters" ALTER COLUMN "turn_order" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "encounters" ALTER COLUMN "battle_log" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "encounters" ALTER COLUMN "hazards" SET DATA TYPE jsonb;