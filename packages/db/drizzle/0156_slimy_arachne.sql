PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_device_profile_printers` (
	`id` text PRIMARY KEY NOT NULL,
	`device_profile_id` text NOT NULL,
	`printer_id` text,
	`page_printer_id` text,
	`role` text NOT NULL,
	`position` integer NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`device_profile_id`) REFERENCES `device_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`page_printer_id`) REFERENCES `page_printers`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "device_profile_printers_role_ck" CHECK("__new_device_profile_printers"."role" in ('receipt', 'payment_slip', 'cash_drawer', 'invoice')),
	CONSTRAINT "device_profile_printers_target_ck" CHECK(("__new_device_profile_printers"."printer_id" is null) <> ("__new_device_profile_printers"."page_printer_id" is null) and ("__new_device_profile_printers"."page_printer_id" is null or "__new_device_profile_printers"."role" = 'invoice'))
);
--> statement-breakpoint
INSERT INTO `__new_device_profile_printers`("id", "device_profile_id", "printer_id", "page_printer_id", "role", "position", "is_default") SELECT "id", "device_profile_id", "printer_id", "page_printer_id", "role", "position", "is_default" FROM `device_profile_printers`;--> statement-breakpoint
DROP TABLE `device_profile_printers`;--> statement-breakpoint
ALTER TABLE `__new_device_profile_printers` RENAME TO `device_profile_printers`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `device_profile_printers_profile_role_default_key` ON `device_profile_printers` (`device_profile_id`,`role`) WHERE "device_profile_printers"."is_default" = 1;--> statement-breakpoint
CREATE UNIQUE INDEX `device_profile_printers_profile_role_page_printer_key` ON `device_profile_printers` (`device_profile_id`,`role`,`page_printer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `device_profile_printers_profile_role_printer_key` ON `device_profile_printers` (`device_profile_id`,`role`,`printer_id`);