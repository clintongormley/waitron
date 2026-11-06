PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_adjustment_reasons` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`names` text NOT NULL,
	`kind` text NOT NULL,
	`actions` text NOT NULL,
	`max_percent` integer,
	`max_amount` integer,
	`apply_roles` text DEFAULT '[]' NOT NULL,
	`approver_roles` text DEFAULT '[]' NOT NULL,
	`note_required` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`position` integer NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "adjustment_reasons_name_ck" CHECK(length(trim("__new_adjustment_reasons"."name")) > 0),
	CONSTRAINT "adjustment_reasons_actions_ck" CHECK(json_array_length("__new_adjustment_reasons"."actions") > 0),
	CONSTRAINT "adjustment_reasons_max_percent_ck" CHECK("__new_adjustment_reasons"."max_percent" is null or ("__new_adjustment_reasons"."max_percent" > 0 and "__new_adjustment_reasons"."max_percent" <= 10000)),
	CONSTRAINT "adjustment_reasons_max_amount_ck" CHECK("__new_adjustment_reasons"."max_amount" is null or "__new_adjustment_reasons"."max_amount" > 0),
	CONSTRAINT "adjustment_reasons_kind_ck" CHECK("__new_adjustment_reasons"."kind" in ('void', 'comp')),
	CONSTRAINT "adjustment_reasons_kind_fields_ck" CHECK(("__new_adjustment_reasons"."kind" = 'void' and json_array_length("__new_adjustment_reasons"."apply_roles") = 0 and json_array_length("__new_adjustment_reasons"."approver_roles") = 0 and "__new_adjustment_reasons"."max_percent" is null and "__new_adjustment_reasons"."max_amount" is null) or ("__new_adjustment_reasons"."kind" = 'comp' and json_array_length("__new_adjustment_reasons"."apply_roles") > 0 and json_array_length("__new_adjustment_reasons"."approver_roles") > 0)),
	CONSTRAINT "adjustment_reasons_position_ck" CHECK("__new_adjustment_reasons"."position" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_adjustment_reasons`("id", "name", "names", "kind", "actions", "max_percent", "max_amount", "apply_roles", "approver_roles", "note_required", "active", "position", "created_at") SELECT "id", "name", "names", "kind", "actions", "max_percent", "max_amount", "apply_roles", "approver_roles", "note_required", "active", "position", "created_at" FROM `adjustment_reasons`;--> statement-breakpoint
DROP TABLE `adjustment_reasons`;--> statement-breakpoint
ALTER TABLE `__new_adjustment_reasons` RENAME TO `adjustment_reasons`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `adjustment_reasons_active_name_key` ON `adjustment_reasons` (`name`) WHERE "adjustment_reasons"."active";--> statement-breakpoint
CREATE TABLE `__new_adjustment_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`max_bill_comp` integer,
	`bill_approver_roles` text DEFAULT '["manager","admin"]' NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "adjustment_settings_singleton_ck" CHECK("__new_adjustment_settings"."id" = 1),
	CONSTRAINT "adjustment_settings_max_bill_comp_ck" CHECK("__new_adjustment_settings"."max_bill_comp" is null or "__new_adjustment_settings"."max_bill_comp" > 0),
	CONSTRAINT "adjustment_settings_bill_approver_roles_ck" CHECK(json_array_length("__new_adjustment_settings"."bill_approver_roles") > 0)
);
--> statement-breakpoint
INSERT INTO `__new_adjustment_settings`("id", "max_bill_comp", "bill_approver_roles", "updated_at") SELECT "id", "max_bill_comp", "bill_approver_roles", "updated_at" FROM `adjustment_settings`;--> statement-breakpoint
DROP TABLE `adjustment_settings`;--> statement-breakpoint
ALTER TABLE `__new_adjustment_settings` RENAME TO `adjustment_settings`;