DROP INDEX `persons_tenant_email_uq`;--> statement-breakpoint
DROP INDEX `persons_tenant_live_display_name_uq`;--> statement-breakpoint
DROP INDEX `persons_tenant_pending_email_uq`;--> statement-breakpoint
ALTER TABLE `persons` ADD `display_name_folded` text;--> statement-breakpoint
ALTER TABLE `persons` ADD `email_folded` text;--> statement-breakpoint
ALTER TABLE `persons` ADD `pending_email_folded` text;--> statement-breakpoint
CREATE UNIQUE INDEX `persons_tenant_email_uq` ON `persons` (case when "email_folded" is null then lower("email") else "email_folded" end) WHERE "persons"."email" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `persons_tenant_live_display_name_uq` ON `persons` (case when "display_name_folded" is null then lower(trim("display_name")) else "display_name_folded" end) WHERE "persons"."status" <> 'suspended';--> statement-breakpoint
CREATE UNIQUE INDEX `persons_tenant_pending_email_uq` ON `persons` (case when "pending_email_folded" is null then lower("pending_email") else "pending_email_folded" end) WHERE "persons"."pending_email" is not null;