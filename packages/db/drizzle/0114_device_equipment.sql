CREATE TABLE `printer_holders` (
	`printer_id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`held_at` text NOT NULL,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `devices` ADD `cash_drawer_printer_id` text REFERENCES printers(id);--> statement-breakpoint
ALTER TABLE `printers` ADD `portable` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `device_profile_printers` ADD `is_default` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `device_profile_printers_profile_role_default_key` ON `device_profile_printers` (`device_profile_id`,`role`) WHERE "device_profile_printers"."is_default" = 1;