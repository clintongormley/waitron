CREATE TABLE `content_suggestion_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`position` integer NOT NULL,
	`state` text NOT NULL,
	`refusal` text,
	`fits` integer,
	`failure` text,
	`cloud_job_id` text,
	`body` text,
	`sent` text NOT NULL,
	`run_total` integer NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`done` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`dropped` integer DEFAULT 0 NOT NULL,
	`failed_refs` text NOT NULL,
	`released` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`finished_at` text,
	`opened_at` text,
	CONSTRAINT "content_suggestion_jobs_state_ck" CHECK("content_suggestion_jobs"."state" in ('submitting', 'running', 'done', 'partly_done', 'failed', 'expired', 'refused')),
	CONSTRAINT "content_suggestion_jobs_refusal_ck" CHECK("content_suggestion_jobs"."refusal" in ('consent', 'limit', 'job_running')),
	CONSTRAINT "content_suggestion_jobs_failure_ck" CHECK("content_suggestion_jobs"."failure" in ('provider', 'not_connected', 'rejected', 'consent', 'limit'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_suggestion_jobs_run_position_key` ON `content_suggestion_jobs` (`run_id`,`position`);--> statement-breakpoint
CREATE TABLE `content_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text,
	`kind` text NOT NULL,
	`item_id` text NOT NULL,
	`language` text,
	`text` text,
	`expected` text,
	`fix_field` text,
	`fix_wrong` text,
	`fix_right` text,
	`placeholder` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `content_suggestion_jobs`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "content_suggestions_kind_ck" CHECK("content_suggestions"."kind" in ('product', 'variant', 'option_list', 'option_label', 'extra_list', 'menu', 'section', 'included_menu', 'unit')),
	CONSTRAINT "content_suggestions_name_ck" CHECK("content_suggestions"."text" is null or "content_suggestions"."expected" is not null),
	CONSTRAINT "content_suggestions_fix_ck" CHECK(("content_suggestions"."fix_field" is null) = ("content_suggestions"."fix_wrong" is null) and ("content_suggestions"."fix_field" is null) = ("content_suggestions"."fix_right" is null)),
	CONSTRAINT "content_suggestions_text_language_ck" CHECK("content_suggestions"."text" is null or "content_suggestions"."language" is not null)
);
--> statement-breakpoint
CREATE INDEX `content_suggestions_language_idx` ON `content_suggestions` (`language`);--> statement-breakpoint
CREATE INDEX `content_suggestions_job_idx` ON `content_suggestions` (`job_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `content_suggestions_item_language_key` ON `content_suggestions` (`kind`,`item_id`,`language`);