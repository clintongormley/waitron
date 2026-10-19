CREATE TABLE `service_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`department_id` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`start` text NOT NULL,
	`course_id` text,
	`minutes` integer NOT NULL,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`course_id`) REFERENCES `kitchen_courses`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "service_steps_start_ck" CHECK("service_steps"."start" in ('seated', 'after_previous', 'course_served', 'all_served', 'since_last_order')),
	CONSTRAINT "service_steps_course_ck" CHECK(("service_steps"."start" = 'course_served') = ("service_steps"."course_id" is not null)),
	CONSTRAINT "service_steps_minutes_ck" CHECK("service_steps"."minutes" between 0 and 120 and ("service_steps"."start" <> 'since_last_order' or "service_steps"."minutes" >= 1))
);
--> statement-breakpoint
CREATE INDEX `service_steps_department_position_idx` ON `service_steps` (`department_id`,`position`);