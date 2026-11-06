ALTER TABLE `floor_reset_tables` ADD `plan_table_id` text REFERENCES floor_plan_tables(id);--> statement-breakpoint
ALTER TABLE `floor_reset_tables` ADD `placed` integer DEFAULT false NOT NULL;