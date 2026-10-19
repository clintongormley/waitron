ALTER TABLE `content_suggestion_jobs` ADD `collect_cursor` integer;--> statement-breakpoint
ALTER TABLE `content_suggestion_jobs` ADD `collected_refs` text DEFAULT '[]' NOT NULL;