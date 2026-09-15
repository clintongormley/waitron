ALTER TABLE "option_groups" DROP CONSTRAINT "option_groups_type_ck";--> statement-breakpoint
ALTER TABLE "option_groups" DROP COLUMN "default_value";--> statement-breakpoint
ALTER TABLE "option_groups" ADD CONSTRAINT "option_groups_type_ck" CHECK ("option_groups"."type" in ('text','extras','options'));