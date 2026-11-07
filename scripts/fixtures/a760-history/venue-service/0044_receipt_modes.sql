PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_department_sale_policies` (
	`department_id` text PRIMARY KEY NOT NULL,
	`order_start` text DEFAULT 'counter' NOT NULL,
	`paid_when` text DEFAULT 'prepay' NOT NULL,
	`collection_number` text DEFAULT 'none' NOT NULL,
	`receipt_print_mode` text DEFAULT 'auto' NOT NULL,
	`print_trading_name` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "department_sale_policies_order_start_ck" CHECK("__new_department_sale_policies"."order_start" in ('table', 'counter')),
	CONSTRAINT "department_sale_policies_paid_when_ck" CHECK("__new_department_sale_policies"."paid_when" in ('prepay', 'ticket_then_pay')),
	CONSTRAINT "department_sale_policies_collection_number_ck" CHECK("__new_department_sale_policies"."collection_number" in ('none', 'numbered')),
	CONSTRAINT "department_sale_policies_receipt_mode_ck" CHECK("__new_department_sale_policies"."receipt_print_mode" in ('auto', 'on_request'))
);
--> statement-breakpoint
INSERT INTO `__new_department_sale_policies`("department_id", "order_start", "paid_when", "collection_number", "receipt_print_mode", "print_trading_name") SELECT "department_id", "order_start", "paid_when", "collection_number", "receipt_print_mode", "print_trading_name" FROM `department_sale_policies`;--> statement-breakpoint
DROP TABLE `department_sale_policies`;--> statement-breakpoint
ALTER TABLE `__new_department_sale_policies` RENAME TO `department_sale_policies`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_zone_sale_policies` (
	`zone_id` text PRIMARY KEY NOT NULL,
	`order_start` text,
	`paid_when` text,
	`collection_number` text,
	`receipt_print_mode` text,
	FOREIGN KEY (`zone_id`) REFERENCES `zone_service_policies`(`zone_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "zone_sale_policies_order_start_ck" CHECK("__new_zone_sale_policies"."order_start" in ('table', 'counter')),
	CONSTRAINT "zone_sale_policies_paid_when_ck" CHECK("__new_zone_sale_policies"."paid_when" in ('prepay', 'ticket_then_pay')),
	CONSTRAINT "zone_sale_policies_collection_number_ck" CHECK("__new_zone_sale_policies"."collection_number" in ('none', 'numbered')),
	CONSTRAINT "zone_sale_policies_receipt_mode_ck" CHECK("__new_zone_sale_policies"."receipt_print_mode" in ('auto', 'on_request'))
);
--> statement-breakpoint
INSERT INTO `__new_zone_sale_policies`("zone_id", "order_start", "paid_when", "collection_number", "receipt_print_mode") SELECT "zone_id", "order_start", "paid_when", "collection_number", "receipt_print_mode" FROM `zone_sale_policies`;--> statement-breakpoint
DROP TABLE `zone_sale_policies`;--> statement-breakpoint
ALTER TABLE `__new_zone_sale_policies` RENAME TO `zone_sale_policies`;