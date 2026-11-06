CREATE TABLE `membership_clearances` (
	`id` text PRIMARY KEY NOT NULL,
	`cleared_node_id` text NOT NULL,
	`person_id` text NOT NULL,
	`term` integer NOT NULL,
	`cleared_at` text NOT NULL
);
