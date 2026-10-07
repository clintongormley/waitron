CREATE TABLE `department_transfer_desks` (
	`department_id` text PRIMARY KEY NOT NULL,
	`receiving_profile_id` text NOT NULL,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`receiving_profile_id`) REFERENCES `device_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `department_transfer_destinations` (
	`source_department_id` text NOT NULL,
	`destination_department_id` text NOT NULL,
	PRIMARY KEY(`source_department_id`, `destination_department_id`),
	FOREIGN KEY (`source_department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`destination_department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "department_transfer_destinations_different_ck" CHECK("department_transfer_destinations"."source_department_id" <> "department_transfer_destinations"."destination_department_id")
);
--> statement-breakpoint
CREATE TABLE `department_transfer_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`tab_id` text NOT NULL,
	`source_department_id` text NOT NULL,
	`destination_department_id` text NOT NULL,
	`sender_id` text NOT NULL,
	`resolved_by` text,
	`destination_zone_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`reason` text,
	`created_at` text NOT NULL,
	`resolved_at` text,
	`revision` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`tab_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`destination_department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`destination_zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "department_transfer_requests_status_ck" CHECK("department_transfer_requests"."status" in ('pending', 'accepted', 'declined', 'withdrawn')),
	CONSTRAINT "department_transfer_requests_different_ck" CHECK("department_transfer_requests"."source_department_id" <> "department_transfer_requests"."destination_department_id"),
	CONSTRAINT "department_transfer_requests_resolved_ck" CHECK(("department_transfer_requests"."status" = 'pending') = ("department_transfer_requests"."resolved_at" is null)),
	CONSTRAINT "department_transfer_requests_decline_reason_ck" CHECK("department_transfer_requests"."status" <> 'declined' or ("department_transfer_requests"."reason" is not null and length(trim("department_transfer_requests"."reason")) > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `department_transfer_requests_one_pending_key` ON `department_transfer_requests` (`tab_id`) WHERE "department_transfer_requests"."status" = 'pending';