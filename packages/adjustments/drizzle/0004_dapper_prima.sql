ALTER TABLE `adjustment_reasons` ADD `kind` text;--> statement-breakpoint
ALTER TABLE `adjustment_reasons` ADD `apply_roles` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `adjustment_reasons` ADD `approver_roles` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `adjustment_settings` ADD `max_bill_comp` integer;--> statement-breakpoint
ALTER TABLE `adjustment_settings` ADD `bill_approver_roles` text DEFAULT '["manager","admin"]' NOT NULL;