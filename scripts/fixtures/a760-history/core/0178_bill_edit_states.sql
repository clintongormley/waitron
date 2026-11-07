CREATE TABLE `bill_edit_states` (
	`bill_id` text PRIMARY KEY NOT NULL,
	`editor_id` text,
	`editor_version` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`bill_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "bill_edit_states_version_ck" CHECK("bill_edit_states"."editor_version" >= 0)
);
