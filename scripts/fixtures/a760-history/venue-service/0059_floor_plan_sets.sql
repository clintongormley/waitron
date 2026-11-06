CREATE TABLE `department_floor_plan_sets` (
	`set_id` text PRIMARY KEY NOT NULL,
	`department_id` text NOT NULL,
	`name` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`set_id`) REFERENCES `floor_plan_sets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "department_floor_plan_sets_name_ck" CHECK(trim("department_floor_plan_sets"."name") <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `department_floor_plan_sets_name_key` ON `department_floor_plan_sets` (`department_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `department_floor_plan_sets_one_default_key` ON `department_floor_plan_sets` (`department_id`) WHERE "department_floor_plan_sets"."is_default";--> statement-breakpoint
ALTER TABLE `menu_periods` ADD `floor_plan_set_id` text REFERENCES floor_plan_sets(id);