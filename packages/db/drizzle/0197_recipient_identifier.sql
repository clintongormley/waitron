ALTER TABLE `working_orders` ADD `recipient_identifier_type` text;--> statement-breakpoint
ALTER TABLE `working_orders` ADD `recipient_identifier_country_code` text;--> statement-breakpoint
ALTER TABLE `sales` ADD `counterparty_identifier_type` text;--> statement-breakpoint
ALTER TABLE `sales` ADD `counterparty_identifier_country_code` text;