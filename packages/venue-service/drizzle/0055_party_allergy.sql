CREATE TABLE `allergy_line_ticks` (
	`id` text PRIMARY KEY NOT NULL,
	`guest_id` text NOT NULL,
	`draft_line_id` text,
	`working_line_id` text,
	FOREIGN KEY (`guest_id`) REFERENCES `party_allergy_guests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`draft_line_id`) REFERENCES `order_draft_lines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`working_line_id`) REFERENCES `working_order_lines`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "allergy_line_ticks_target_ck" CHECK(("allergy_line_ticks"."draft_line_id" is null) <> ("allergy_line_ticks"."working_line_id" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `allergy_line_ticks_draft_key` ON `allergy_line_ticks` (`draft_line_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `allergy_line_ticks_working_key` ON `allergy_line_ticks` (`working_line_id`);--> statement-breakpoint
CREATE TABLE `party_allergy` (
	`party_id` text PRIMARY KEY NOT NULL,
	`answer` text NOT NULL,
	`changed_by` text NOT NULL,
	`changed_at` text NOT NULL,
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "party_allergy_answer_ck" CHECK("party_allergy"."answer" in ('none', 'allergies'))
);
--> statement-breakpoint
CREATE TABLE `party_allergy_guests` (
	`id` text PRIMARY KEY NOT NULL,
	`party_id` text NOT NULL,
	`position` integer NOT NULL,
	`who` text NOT NULL,
	`allergens` text NOT NULL,
	`note` text,
	FOREIGN KEY (`party_id`) REFERENCES `party_allergy`(`party_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "party_allergy_guests_position_ck" CHECK(typeof("party_allergy_guests"."position") = 'integer' and "party_allergy_guests"."position" >= 0),
	CONSTRAINT "party_allergy_guests_who_ck" CHECK(length(trim("party_allergy_guests"."who")) between 1 and 40),
	CONSTRAINT "party_allergy_guests_allergens_ck" CHECK(json_valid("party_allergy_guests"."allergens") and json_type("party_allergy_guests"."allergens") = 'object' and "party_allergy_guests"."allergens" <> '{}'),
	CONSTRAINT "party_allergy_guests_note_ck" CHECK("party_allergy_guests"."note" is null or length("party_allergy_guests"."note") <= 2000)
);
