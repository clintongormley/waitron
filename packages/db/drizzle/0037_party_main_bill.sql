ALTER TABLE `parties` ADD `name` text;--> statement-breakpoint
ALTER TABLE `parties` ADD `main_bill_id` text REFERENCES working_orders(id);