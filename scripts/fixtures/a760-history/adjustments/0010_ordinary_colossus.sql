CREATE TABLE `adjustment_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`adjustment_id` text NOT NULL,
	`line_id` text NOT NULL,
	`reduction` integer NOT NULL,
	`quantity` integer NOT NULL,
	FOREIGN KEY (`adjustment_id`) REFERENCES `adjustments`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `adjustment_lines_adjustment_line_key` ON `adjustment_lines` (`adjustment_id`,`line_id`);--> statement-breakpoint
CREATE INDEX `adjustment_lines_line_idx` ON `adjustment_lines` (`line_id`);