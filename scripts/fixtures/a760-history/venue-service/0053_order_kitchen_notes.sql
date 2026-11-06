CREATE TABLE `order_kitchen_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`working_order_id` text,
	`party_id` text,
	`note` text,
	`revision` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`working_order_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "order_kitchen_notes_owner_ck" CHECK(("order_kitchen_notes"."working_order_id" is null) <> ("order_kitchen_notes"."party_id" is null)),
	CONSTRAINT "order_kitchen_notes_revision_ck" CHECK(typeof("order_kitchen_notes"."revision") = 'integer' and "order_kitchen_notes"."revision" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_kitchen_notes_order_key` ON `order_kitchen_notes` (`working_order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `order_kitchen_notes_party_key` ON `order_kitchen_notes` (`party_id`);