CREATE TABLE `menu_scheduled_publications` (
	`version_id` text PRIMARY KEY NOT NULL,
	`menu_id` text NOT NULL,
	`activates_at` text NOT NULL,
	`queued_at` text NOT NULL,
	`queued_by` text NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`activated_at` text,
	`cancelled_at` text,
	`cancelled_by` text,
	FOREIGN KEY (`menu_id`) REFERENCES `catalogues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`version_id`,`menu_id`) REFERENCES `menu_versions`(`id`,`menu_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "menu_scheduled_publications_state_ck" CHECK("menu_scheduled_publications"."state" in ('queued', 'activated', 'cancelled')),
	CONSTRAINT "menu_scheduled_publications_settled_ck" CHECK(("menu_scheduled_publications"."state" = 'queued' and "menu_scheduled_publications"."activated_at" is null and "menu_scheduled_publications"."cancelled_at" is null and "menu_scheduled_publications"."cancelled_by" is null) or ("menu_scheduled_publications"."state" = 'activated' and "menu_scheduled_publications"."activated_at" is not null and "menu_scheduled_publications"."cancelled_at" is null and "menu_scheduled_publications"."cancelled_by" is null) or ("menu_scheduled_publications"."state" = 'cancelled' and "menu_scheduled_publications"."cancelled_at" is not null and "menu_scheduled_publications"."cancelled_by" is not null and "menu_scheduled_publications"."activated_at" is null)),
	CONSTRAINT "menu_scheduled_publications_after_queue_ck" CHECK("menu_scheduled_publications"."activates_at" > "menu_scheduled_publications"."queued_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `menu_scheduled_publications_queued_time_uq` ON `menu_scheduled_publications` (`menu_id`,`activates_at`) WHERE "menu_scheduled_publications"."state" = 'queued';