PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_service_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`edit_sent_lines` integer DEFAULT true NOT NULL,
	CONSTRAINT "service_settings_singleton_ck" CHECK("__new_service_settings"."id" = 1)
);
--> statement-breakpoint
INSERT INTO `__new_service_settings`("id", "edit_sent_lines") SELECT "id", "edit_sent_lines" FROM `service_settings`;--> statement-breakpoint
DROP TABLE `service_settings`;--> statement-breakpoint
ALTER TABLE `__new_service_settings` RENAME TO `service_settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;