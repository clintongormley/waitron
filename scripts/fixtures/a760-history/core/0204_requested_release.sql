ALTER TABLE `order_groups` ADD `request_kind` text DEFAULT 'new_order' NOT NULL;--> statement-breakpoint
ALTER TABLE `kitchen_stations` ADD `waits_for_pass` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `ticket_items` ADD `requested_at` text;--> statement-breakpoint
ALTER TABLE `ticket_items` ADD `pass_controlled` integer DEFAULT false NOT NULL;