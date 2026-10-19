CREATE TABLE `payment_hold_outcomes` (
	`id` text PRIMARY KEY NOT NULL,
	`hold_id` text NOT NULL,
	`outcome` text NOT NULL,
	`note` text,
	`person_id` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`hold_id`) REFERENCES `payment_holds`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "payment_hold_outcomes_outcome_ck" CHECK("payment_hold_outcomes"."outcome" in ('refunded_at_provider', 'kept')),
	CONSTRAINT "payment_hold_outcomes_note_ck" CHECK("payment_hold_outcomes"."note" is null or length(trim("payment_hold_outcomes"."note")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_hold_outcomes_hold_key` ON `payment_hold_outcomes` (`hold_id`);--> statement-breakpoint
CREATE TABLE `payment_holds` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`provider_amount` integer NOT NULL,
	`found_at` text NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "payment_holds_provider_amount_ck" CHECK("payment_holds"."provider_amount" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_holds_payment_key` ON `payment_holds` (`payment_id`);