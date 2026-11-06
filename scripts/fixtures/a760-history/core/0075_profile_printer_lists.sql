CREATE TABLE `device_profile_printers` (
	`id` text PRIMARY KEY NOT NULL,
	`device_profile_id` text NOT NULL,
	`printer_id` text NOT NULL,
	`role` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`device_profile_id`) REFERENCES `device_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "device_profile_printers_role_ck" CHECK("device_profile_printers"."role" in ('receipt', 'payment_slip'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_profile_printers_profile_role_printer_key` ON `device_profile_printers` (`device_profile_id`,`role`,`printer_id`);--> statement-breakpoint
ALTER TABLE `devices` ADD `payment_slip_printer_id` text REFERENCES printers(id);