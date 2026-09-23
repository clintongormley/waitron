CREATE TABLE `bookings` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`booking_date` text NOT NULL,
	`booking_time` text NOT NULL,
	`party_size` integer NOT NULL,
	`contact_name` text NOT NULL,
	`contact_phone` text,
	`notes` text,
	`table_id` text,
	`tab_id` text,
	`status` text DEFAULT 'booked' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`table_id`) REFERENCES `dining_tables`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tab_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bookings_party_size_ck" CHECK("bookings"."party_size" > 0),
	CONSTRAINT "bookings_status_ck" CHECK("bookings"."status" in ('booked', 'seated', 'completed', 'no_show', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX `bookings_location_date_idx` ON `bookings` (`location_id`,`booking_date`);--> statement-breakpoint
CREATE INDEX `bookings_table_status_date_time_idx` ON `bookings` (`table_id`,`status`,`booking_date`,`booking_time`);