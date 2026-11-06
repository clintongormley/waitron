PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_service_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`edit_sent_lines` integer DEFAULT true NOT NULL,
	`clearing_workflow` integer DEFAULT false NOT NULL,
	`kitchen_ticket_grouping` text DEFAULT 'combined' NOT NULL,
	CONSTRAINT "service_settings_singleton_ck" CHECK("__new_service_settings"."id" = 1),
	CONSTRAINT "service_settings_kitchen_ticket_grouping_ck" CHECK("__new_service_settings"."kitchen_ticket_grouping" in ('combined', 'separate'))
);
--> statement-breakpoint
INSERT INTO `__new_service_settings`("id", "edit_sent_lines", "clearing_workflow", "kitchen_ticket_grouping") SELECT "id", "edit_sent_lines", "clearing_workflow", "kitchen_ticket_grouping" FROM `service_settings`;--> statement-breakpoint
DROP TABLE `service_settings`;--> statement-breakpoint
ALTER TABLE `__new_service_settings` RENAME TO `service_settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;