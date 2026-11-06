PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_device_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`form_factor` text NOT NULL,
	`capabilities` text DEFAULT '[]' NOT NULL,
	`inactivity_timeout_seconds` integer,
	`starting_screen` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`retired_at` text,
	CONSTRAINT "device_profiles_form_factor_ck" CHECK("__new_device_profiles"."form_factor" in ('till', 'phone-portrait', 'tablet-landscape', 'kds'))
);
--> statement-breakpoint
INSERT INTO `__new_device_profiles`("id", "name", "form_factor", "capabilities", "inactivity_timeout_seconds", "starting_screen", "created_at", "updated_at", "retired_at") SELECT "id", "name", "form_factor", "capabilities", "inactivity_timeout_seconds", "starting_screen", "created_at", "updated_at", "retired_at" FROM `device_profiles`;--> statement-breakpoint
DROP TABLE `device_profiles`;--> statement-breakpoint
ALTER TABLE `__new_device_profiles` RENAME TO `device_profiles`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `device_profiles_live_name_key` ON `device_profiles` (`name`) WHERE "device_profiles"."retired_at" is null;
--> statement-breakpoint
DROP TABLE `canvases`;