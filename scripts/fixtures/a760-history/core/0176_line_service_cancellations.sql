CREATE TABLE `line_service_cancellations` (
	`line_id` text PRIMARY KEY NOT NULL,
	`quantity` integer NOT NULL,
	`cancelled_at` text NOT NULL,
	`was_started` integer NOT NULL,
	`actor_id` text NOT NULL,
	FOREIGN KEY (`line_id`) REFERENCES `working_order_lines`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "line_service_cancellations_quantity_ck" CHECK("line_service_cancellations"."quantity" > 0)
);
