ALTER TABLE `working_order_lines` ADD `sent_at` text;--> statement-breakpoint
ALTER TABLE `working_order_lines` ADD `extra_list_id` text;--> statement-breakpoint
ALTER TABLE `working_orders` ADD `revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `working_orders` ADD `payment_attempt_at` text;--> statement-breakpoint
ALTER TABLE `ticket_items` ADD `quantity` integer;