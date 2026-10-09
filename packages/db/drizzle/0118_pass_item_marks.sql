CREATE TABLE `pass_item_marks` (
	`device_id` text NOT NULL,
	`ticket_item_id` text NOT NULL,
	`done_at` text NOT NULL,
	`done_by_person_id` text,
	PRIMARY KEY(`device_id`, `ticket_item_id`),
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ticket_item_id`) REFERENCES `ticket_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pass_item_marks_item_idx` ON `pass_item_marks` (`ticket_item_id`);