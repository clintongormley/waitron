DROP INDEX `device_profiles_tenant_name_key`;--> statement-breakpoint
ALTER TABLE `device_profiles` ADD `retired_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `device_profiles_live_name_key` ON `device_profiles` (`name`) WHERE "device_profiles"."retired_at" is null;