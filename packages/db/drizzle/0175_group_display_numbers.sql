ALTER TABLE `order_groups` ADD `display_number` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `order_groups` ADD `number_party_id` text REFERENCES parties(id);