CREATE TABLE `membership_removals` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`contact_url` text NOT NULL,
	`person_id` text NOT NULL,
	`term` integer NOT NULL,
	`removed_at` text NOT NULL
);
