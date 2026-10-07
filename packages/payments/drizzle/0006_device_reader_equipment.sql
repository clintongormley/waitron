CREATE TABLE `card_reader_holders` (
	`reader_id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`held_at` text NOT NULL,
	FOREIGN KEY (`reader_id`) REFERENCES `card_readers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `device_profile_card_readers` (
	`device_profile_id` text NOT NULL,
	`reader_id` text NOT NULL,
	`position` integer NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`device_profile_id`, `reader_id`),
	FOREIGN KEY (`device_profile_id`) REFERENCES `device_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reader_id`) REFERENCES `card_readers`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_profile_card_readers_profile_default_key` ON `device_profile_card_readers` (`device_profile_id`) WHERE "device_profile_card_readers"."is_default" = 1;--> statement-breakpoint
CREATE INDEX `payments_reader_idx` ON `payments` (`reader_id`);