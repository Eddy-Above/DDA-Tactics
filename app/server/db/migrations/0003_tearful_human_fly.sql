ALTER TABLE `digimon` ADD `bonus_stats` text DEFAULT '{"accuracy":0,"damage":0,"dodge":0,"armor":0,"health":0}' NOT NULL;--> statement-breakpoint
ALTER TABLE `digimon` ADD `bonus_dp_for_qualities` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `digimon` ADD `evolves_from_id` text;--> statement-breakpoint
ALTER TABLE `tamers` ADD `xp_bonuses` text DEFAULT '{"attributes":{"agility":0,"body":0,"charisma":0,"intelligence":0,"willpower":0},"skills":{"dodge":0,"fight":0,"stealth":0,"athletics":0,"endurance":0,"featsOfStrength":0,"manipulate":0,"perform":0,"persuasion":0,"computer":0,"survival":0,"knowledge":0,"perception":0,"decipherIntent":0,"bravery":0},"inspiration":0}' NOT NULL;--> statement-breakpoint
ALTER TABLE `tamers` ADD `sprite_url` text;