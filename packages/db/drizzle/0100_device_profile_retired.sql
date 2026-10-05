DROP INDEX `device_profiles_tenant_name_key`;--> statement-breakpoint
ALTER TABLE `device_profiles` ADD `deleted_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `device_profiles_tenant_name_key` ON `device_profiles` (`name`) WHERE "device_profiles"."deleted_at" is null;