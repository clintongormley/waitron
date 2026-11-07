PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_invoice_series` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`code` text NOT NULL,
	`purpose` text DEFAULT 'standard' NOT NULL,
	`next_number` integer DEFAULT 1 NOT NULL,
	`retired_at` text,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invoice_series_purpose_ck" CHECK("__new_invoice_series"."purpose" in ('standard', 'full', 'rectificative')),
	CONSTRAINT "invoice_series_next_number_ck" CHECK("__new_invoice_series"."next_number" >= 1),
	CONSTRAINT "invoice_series_code_ck" CHECK("__new_invoice_series"."code" <> '')
);
--> statement-breakpoint
INSERT INTO `__new_invoice_series`("id", "node_id", "code", "purpose", "next_number", "retired_at") SELECT "id", "node_id", "code", "purpose", "next_number", "retired_at" FROM `invoice_series`;--> statement-breakpoint
DROP TABLE `invoice_series`;--> statement-breakpoint
ALTER TABLE `__new_invoice_series` RENAME TO `invoice_series`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_series_node_code_key` ON `invoice_series` (`node_id`,`code`);--> statement-breakpoint
ALTER TABLE `tenants` ADD `taxpayer_domicile` text;--> statement-breakpoint
ALTER TABLE `working_orders` ADD `invoice_type` text DEFAULT 'F2' NOT NULL;--> statement-breakpoint
ALTER TABLE `working_orders` ADD `recipient_tax_id` text;--> statement-breakpoint
ALTER TABLE `working_orders` ADD `recipient_legal_name` text;--> statement-breakpoint
ALTER TABLE `working_orders` ADD `recipient_address` text;--> statement-breakpoint
ALTER TABLE `working_orders` ADD `recipient_country_code` text;--> statement-breakpoint
ALTER TABLE `print_jobs` ADD `receipt_copy` integer;--> statement-breakpoint
ALTER TABLE `print_jobs` ADD `receipt_handover` text;--> statement-breakpoint
ALTER TABLE `sale_lines` ADD `list_gross` integer;--> statement-breakpoint
ALTER TABLE `sales` ADD `operation_date` text;--> statement-breakpoint
ALTER TABLE `sales` ADD `counterparty_address` text;--> statement-breakpoint
ALTER TABLE `sales` ADD `taxpayer_domicile` text;