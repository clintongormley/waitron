CREATE TABLE `custom_themes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`in_use` integer,
	`theme` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "custom_themes_in_use_ck" CHECK("custom_themes"."in_use" = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_themes_name_key_uq` ON `custom_themes` (`name_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `custom_themes_in_use_uq` ON `custom_themes` (`in_use`);