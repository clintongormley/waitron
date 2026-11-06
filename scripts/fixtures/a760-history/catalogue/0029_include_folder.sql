ALTER TABLE `section_members` ADD `show_as_folder` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `section_members` ADD `folder_overrides` text DEFAULT '{}' NOT NULL;