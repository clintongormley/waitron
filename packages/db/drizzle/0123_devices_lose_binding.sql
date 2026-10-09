DROP TABLE `watcher_item_marks`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`device_profile_id` text NOT NULL,
	`receipt_printer_id` text,
	`payment_slip_printer_id` text,
	`cash_drawer_printer_id` text,
	`label` text NOT NULL,
	`token_hash` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`last_seen_at` text,
	`battery_level` integer,
	`battery_charging` integer,
	`battery_reported_at` text,
	`enrolled_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`device_profile_id`) REFERENCES `device_profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`receipt_printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`payment_slip_printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`cash_drawer_printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_devices`("id", "location_id", "device_profile_id", "receipt_printer_id", "payment_slip_printer_id", "cash_drawer_printer_id", "label", "token_hash", "active", "last_seen_at", "battery_level", "battery_charging", "battery_reported_at", "enrolled_at", "created_at") SELECT "id", "location_id", "device_profile_id", "receipt_printer_id", "payment_slip_printer_id", "cash_drawer_printer_id", "label", "token_hash", "active", "last_seen_at", "battery_level", "battery_charging", "battery_reported_at", "enrolled_at", "created_at" FROM `devices`;--> statement-breakpoint
DROP TABLE `devices`;--> statement-breakpoint
ALTER TABLE `__new_devices` RENAME TO `devices`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `devices_location_label_active_key` ON `devices` (`location_id`,`label`) WHERE "devices"."active" = 1;