CREATE INDEX `working_order_lines_course_idx` ON `working_order_lines` (`course_id`);--> statement-breakpoint
CREATE INDEX `order_draft_lines_course_idx` ON `order_draft_lines` (`course_id`);--> statement-breakpoint
CREATE INDEX `ticket_items_course_idx` ON `ticket_items` (`course_id`);--> statement-breakpoint
CREATE INDEX `products_course_idx` ON `products` (`course_id`);