CREATE TABLE `scheduled_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`duty` text NOT NULL,
	`period_from` text NOT NULL,
	`period_to` text NOT NULL,
	`generation` integer DEFAULT 0 NOT NULL,
	`state` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text,
	`started_at` text,
	`finished_at` text,
	`summary` text,
	`error_code` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "scheduled_runs_state_ck" CHECK("scheduled_runs"."state" in ('pending', 'running', 'succeeded', 'failed', 'parked')),
	CONSTRAINT "scheduled_runs_period_ck" CHECK("scheduled_runs"."period_from" < "scheduled_runs"."period_to"),
	CONSTRAINT "scheduled_runs_generation_ck" CHECK("scheduled_runs"."generation" >= 0),
	CONSTRAINT "scheduled_runs_attempts_ck" CHECK("scheduled_runs"."attempts" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scheduled_runs_key` ON `scheduled_runs` (`duty`,`period_from`,`generation`);