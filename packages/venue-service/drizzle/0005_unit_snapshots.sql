ALTER TABLE "working_line_contexts" DROP CONSTRAINT "working_line_contexts_pricing_unit_ck";--> statement-breakpoint
ALTER TABLE "working_line_contexts" ADD COLUMN "unit_name" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "working_line_contexts" ADD COLUMN "unit_precision" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "working_line_contexts" ADD COLUMN "hardware_unit" text;--> statement-breakpoint
ALTER TABLE "working_line_contexts" DROP COLUMN "pricing_unit";--> statement-breakpoint
ALTER TABLE "working_line_contexts" ADD CONSTRAINT "working_line_contexts_unit_precision_ck" CHECK ("working_line_contexts"."unit_precision" between 0 and 3);--> statement-breakpoint
ALTER TABLE "working_line_contexts" ADD CONSTRAINT "working_line_contexts_hardware_unit_ck" CHECK ("working_line_contexts"."hardware_unit" is null or "working_line_contexts"."hardware_unit" in ('kg','g','mg'));