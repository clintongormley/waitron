CREATE TABLE `adjustment_reasons` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`names` text NOT NULL,
	`actions` text NOT NULL,
	`max_percent` integer,
	`max_amount` integer,
	`apply_role` text NOT NULL,
	`approver_role` text NOT NULL,
	`note_required` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`position` integer NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "adjustment_reasons_name_ck" CHECK(length(trim("adjustment_reasons"."name")) > 0),
	CONSTRAINT "adjustment_reasons_actions_ck" CHECK(json_array_length("adjustment_reasons"."actions") > 0),
	CONSTRAINT "adjustment_reasons_max_percent_ck" CHECK("adjustment_reasons"."max_percent" is null or ("adjustment_reasons"."max_percent" > 0 and "adjustment_reasons"."max_percent" <= 10000)),
	CONSTRAINT "adjustment_reasons_max_amount_ck" CHECK("adjustment_reasons"."max_amount" is null or "adjustment_reasons"."max_amount" > 0),
	CONSTRAINT "adjustment_reasons_apply_role_ck" CHECK("adjustment_reasons"."apply_role" in ('staff', 'supervisor', 'manager', 'admin')),
	CONSTRAINT "adjustment_reasons_approver_role_ck" CHECK("adjustment_reasons"."approver_role" in ('staff', 'supervisor', 'manager', 'admin')),
	CONSTRAINT "adjustment_reasons_position_ck" CHECK("adjustment_reasons"."position" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `adjustment_reasons_active_name_key` ON `adjustment_reasons` (`name`) WHERE "adjustment_reasons"."active";