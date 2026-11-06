CREATE TABLE `bill_identities` (
	`working_order_id` text PRIMARY KEY NOT NULL,
	`party_id` text,
	`number` integer,
	`name` text,
	FOREIGN KEY (`working_order_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bill_identities_scope_ck" CHECK(("bill_identities"."party_id" is null) = ("bill_identities"."number" is null)),
	CONSTRAINT "bill_identities_number_ck" CHECK("bill_identities"."number" is null or (typeof("bill_identities"."number") = 'integer' and "bill_identities"."number" >= 1)),
	CONSTRAINT "bill_identities_name_ck" CHECK("bill_identities"."name" is null or (length("bill_identities"."name") between 1 and 40 and "bill_identities"."name" = trim("bill_identities"."name")))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bill_identities_party_number_key` ON `bill_identities` (`party_id`,`number`);--> statement-breakpoint
CREATE TABLE `bill_number_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`party_id` text NOT NULL,
	`number` integer NOT NULL,
	`working_order_id` text NOT NULL,
	`allocated_at` text NOT NULL,
	CONSTRAINT "bill_number_allocations_number_ck" CHECK(typeof("bill_number_allocations"."number") = 'integer' and "bill_number_allocations"."number" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bill_number_allocations_party_number_key` ON `bill_number_allocations` (`party_id`,`number`);