CREATE TABLE `department_sale_policies` (
	`department_id` text PRIMARY KEY NOT NULL,
	`paid_when` text DEFAULT 'prepay' NOT NULL,
	`collection_number` text DEFAULT 'none' NOT NULL,
	`receipt_print_mode` text DEFAULT 'auto' NOT NULL,
	`print_trading_name` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "department_sale_policies_paid_when_ck" CHECK("department_sale_policies"."paid_when" in ('prepay', 'ticket_then_pay')),
	CONSTRAINT "department_sale_policies_collection_number_ck" CHECK("department_sale_policies"."collection_number" in ('none', 'numbered')),
	CONSTRAINT "department_sale_policies_receipt_mode_ck" CHECK("department_sale_policies"."receipt_print_mode" in ('auto', 'on_request', 'never'))
);
--> statement-breakpoint
CREATE TABLE `sale_receipt_headers` (
	`sale_id` text PRIMARY KEY NOT NULL,
	`department_id` text,
	`trading_name` text NOT NULL,
	`print_trading_name` integer NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `zone_sale_policies` (
	`zone_id` text PRIMARY KEY NOT NULL,
	`paid_when` text,
	`collection_number` text,
	`receipt_print_mode` text,
	FOREIGN KEY (`zone_id`) REFERENCES `zone_service_policies`(`zone_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "zone_sale_policies_paid_when_ck" CHECK("zone_sale_policies"."paid_when" in ('prepay', 'ticket_then_pay')),
	CONSTRAINT "zone_sale_policies_collection_number_ck" CHECK("zone_sale_policies"."collection_number" in ('none', 'numbered')),
	CONSTRAINT "zone_sale_policies_receipt_mode_ck" CHECK("zone_sale_policies"."receipt_print_mode" in ('auto', 'on_request', 'never'))
);
